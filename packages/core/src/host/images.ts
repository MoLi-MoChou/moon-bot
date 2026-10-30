import type { LlmStreamChunk } from './llm-bits.ts'
import type { AgentSession, AgentStatusEvent, AttachmentRef, LlmStreamOptions } from './host-types.js'
import type { HostRuntime } from './runtime.js'

/** What one image was read as, and by which model. */
interface ImageReading {
  readonly text: string
  readonly model: string
}

interface OffloadTarget {
  readonly seq: number
  readonly imageIndexes: readonly number[]
}

/** A content block of a message. */
interface MessageBlock {
  readonly type?: string
  readonly text?: string
  readonly attachment?: AttachmentRef
  readonly offloaded?: boolean
  readonly [key: string]: unknown
}

interface ChatMessage {
  readonly content?: readonly MessageBlock[]
  readonly [key: string]: unknown
}

// Images for text-only models. Every model may take images; before a Session request
// reaches a model that cannot read them, each image becomes text from a vision model.
// Texts are kept per attachment, so later requests repeat the same words and the
// prompt cache still hits.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BlockAssembler } from './llm-bits.ts'
import { OCR_CACHE_MAX, OCR_PROMPT, OCR_RETRY_MS, OCR_TIMEOUT_MS } from './constants.ts'
import { replaceFile } from './files.ts'
import { splitRef } from './text.ts'

export function offloadTargets(session: AgentSession, beforeSeq: number): readonly OffloadTarget[] {
  const targets: OffloadTarget[] = []
  for (const seq of session.surface?.nodes ?? []) {
    if (seq >= beforeSeq) continue
    const event = session.eventAt?.(seq)
    if (event?.type !== 'user/message' && event?.type !== 'tool/result') continue
    const message = session.deriveEventMessage?.(event)
    const imageIndexes: number[] = []
    let imageIndex = 0
    for (const block of message?.content ?? []) {
      if (block?.type !== 'image') continue
      if (block.offloaded !== true) imageIndexes.push(imageIndex)
      imageIndex += 1
    }
    if (imageIndexes.length > 0) targets.push({ seq, imageIndexes })
  }
  return targets
}

export function install(rt: HostRuntime): void {
  const { ctx, config, home } = rt

  // `textOnlyModels` names models whose provider claims image input but rejects it.
  const textOnlyModels = new Set(config.textOnlyModels ?? [])
  const ocrPath = join(home, 'ocr.json')
  let ocrCache: Map<string, ImageReading> | null = null
  let ocrWriting: Promise<unknown> = Promise.resolve()
  const ocrPending = new Map<string, Promise<ImageReading | null>>()
  const ocrFailed = new Map<string, { readonly at: number }>()

  const liveImages = (message: unknown): boolean => {
    const content = (message as ChatMessage | undefined)?.content
    return Array.isArray(content) && content.some(block => block?.type === 'image' && !block.offloaded)
  }

  async function readsImages(provider: string, model: string): Promise<boolean> {
    if (textOnlyModels.has(`${provider}/${model}`)) return false
    try {
      const info = await ctx.llm.resolveModelInfo(provider, model)
      return info.inputModalities === undefined || info.inputModalities.includes('image')
    } catch {
      return true
    }
  }

  // The configured `ocrModel` first, then served models that declare image input, the
  // the host default among them first.
  async function ocrRoute(): Promise<({ ref: string } & { provider: string; model: string }) | undefined> {
    const models = await rt.catalog()
    const served = new Set(models.map(entry => entry.ref))
    const declared = models.filter(entry => entry.input?.includes('image')).map(entry => entry.ref)
    const fallback = rt.defaultRef?.()
    for (const ref of new Set([config.ocrModel, ...declared.filter(ref => ref === fallback), ...declared])) {
      if (ref === undefined) continue
      const route = splitRef(ref)
      if (route && served.has(ref) && (await readsImages(route.provider, route.model))) return { ref, ...route }
    }
    return undefined
  }

  async function loadOcr(): Promise<void> {
    if (ocrCache !== null) return
    try {
      ocrCache = new Map(Object.entries(JSON.parse(await readFile(ocrPath, 'utf8')) as Record<string, ImageReading>))
    } catch (error) {
      if ((error as { readonly code?: unknown } | undefined)?.code !== 'ENOENT')
        rt.warn('moon-bot: unreadable OCR cache %s: %s', ocrPath, error)
      ocrCache = new Map()
    }
  }

  function saveOcr(): void {
    while (ocrCache !== null && ocrCache.size > OCR_CACHE_MAX) {
      const first = ocrCache.keys().next().value
      if (first === undefined) break
      ocrCache.delete(first)
    }
    const snapshot = JSON.stringify(Object.fromEntries(ocrCache ?? new Map()))
    ocrWriting = ocrWriting
      .then(async () => {
        await mkdir(home, { recursive: true })
        const temp = `${ocrPath}.${process.pid}.tmp`
        await writeFile(temp, snapshot, 'utf8')
        await replaceFile(temp, ocrPath)
      })
      .catch(error => rt.warn('moon-bot: OCR cache write failed: %s', error))
  }

  // `sessionId` is the Session the reading is for; its usage counts there.
  async function readImage(attachment: AttachmentRef, sessionId: string): Promise<ImageReading> {
    const route = await ocrRoute()
    if (route === undefined) throw new Error('no vision model is available')
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      sessionId,
      messages: rt.tagUsage(
        [
          {
            role: 'user',
            content: [
              { type: 'image', attachment },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
        { sessionId, kind: 'image' },
      ),
      maxTokens: 8192,
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    }))
      assembler.push(chunk as LlmStreamChunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure?.message ?? finish.kind)
    const text = assembler
      .blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text === '') throw new Error('the vision model returned no text')
    const model = (await rt.catalog()).find(entry => entry.ref === route.ref)?.name ?? route.model
    return { text, model }
  }

  // Resolves to the cached reading, or to null when the image cannot be read now.
  async function imageReading(attachment: AttachmentRef, sessionId: string): Promise<ImageReading | null> {
    const cache = ocrCache
    if (cache === null) return null
    const id = String(attachment.attachmentId)
    if (cache.has(id)) return cache.get(id) ?? null
    const failed = ocrFailed.get(id)
    if (failed && Date.now() - failed.at < OCR_RETRY_MS) return null
    if (!ocrPending.has(id)) {
      ocrPending.set(
        id,
        readImage(attachment, sessionId)
          .then(
            reading => {
              cache.set(id, reading)
              ocrFailed.delete(id)
              saveOcr()
              return reading
            },
            error => {
              rt.warn('moon-bot: could not read image %s: %s', id, error)
              ocrFailed.set(id, { at: Date.now() })
              return null
            },
          )
          .finally(() => ocrPending.delete(id)),
      )
    }
    return ocrPending.get(id) ?? null
  }

  const imageLabel = (attachment: AttachmentRef): string =>
    attachment.name
      ? `"${attachment.name}"`
      : `sha256:${String(attachment.attachmentId).slice('sha256:'.length, 'sha256:'.length + 8)}`

  function imageAsText(attachment: AttachmentRef, reading: ImageReading | null): { type: string; text: string } {
    const label = imageLabel(attachment)
    return {
      type: 'text',
      text:
        reading === null
          ? `[Image ${label}: you cannot see images and it could not be read right now. Ask the user what it shows if it matters.]`
          : `[Image ${label}. You cannot see images, so ${reading.model} read it for you:]\n${reading.text}\n[End of image ${label}]`,
    }
  }

  // Members read the group as text, so a picture posted there reaches every member,
  // vision model or not, as its reading.
  async function imagesForGroup(attachments: readonly AttachmentRef[], sessionId: string): Promise<readonly string[]> {
    await loadOcr()
    return Promise.all(
      attachments.map(async attachment => {
        const reading = await imageReading(attachment, sessionId)
        const label = imageLabel(attachment)
        return reading === null
          ? `[Image ${label}: it could not be read right now. Ask the user what it shows if it matters.]`
          : `[Image ${label}, read by ${reading.model}:]\n${reading.text}\n[End of image ${label}]`
      }),
    )
  }

  async function withImagesAsText(
    messages: readonly ChatMessage[],
    sessionId: string,
  ): Promise<readonly ChatMessage[]> {
    await loadOcr()
    const images = new Map<string, AttachmentRef>()
    for (const message of messages) {
      if (!liveImages(message)) continue
      for (const block of message.content ?? []) {
        if (block?.type === 'image' && !block.offloaded && block.attachment !== undefined)
          images.set(String(block.attachment.attachmentId), block.attachment)
      }
    }
    const readings = new Map(
      await Promise.all(
        [...images].map(
          async ([id, attachment]): Promise<[string, ImageReading | null]> => [
            id,
            await imageReading(attachment, sessionId),
          ],
        ),
      ),
    )
    return messages.map(message =>
      liveImages(message)
        ? {
            ...message,
            content: (message.content ?? []).map(block =>
              block?.type === 'image' && !block.offloaded && block.attachment !== undefined
                ? imageAsText(block.attachment, readings.get(String(block.attachment.attachmentId)) ?? null)
                : block,
            ),
          }
        : message,
    )
  }

  ctx.on<LlmStreamOptions, () => AsyncIterable<unknown>>('llm/stream', (options, next) => {
    const sessionId = options.sessionId
    if (sessionId === undefined || rt.ownRequest(options) || !(options.messages ?? []).some(liveImages)) return next()
    return (async function* imagesAsTextOrPass() {
      await rt.load()
      if (rt.roomOf(sessionId) !== undefined || (await readsImages(options.provider, options.model))) {
        yield* next()
        return
      }
      // `next` cannot take new messages, so the rewritten request starts over; it
      // carries no image, so this listener lets it through.
      yield* ctx.llm.stream({
        ...options,
        messages: await withImagesAsText(options.messages as readonly ChatMessage[], sessionId),
      })
    })()
  })

  ctx.on<AgentStatusEvent>('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || !agent?.session || !rt.isBotSession(agent.id) || rt.readOnly() !== undefined) return
    const beforeSeq = agent.session.seq
    setImmediate(() => {
      void (async () => {
        try {
          if (!ctx.sessions.messageProjections.some(projection => projection.type === 'image/offload')) return
          const targets = offloadTargets(agent.session, beforeSeq)
          if (targets.length === 0) return
          agent.session.append?.('image/offload', { targets })
          await ctx.sessions.flush(agent.session)
        } catch (error) {
          rt.warn('moon-bot: old images for %s not offloaded: %s', agent.id, error)
        }
      })()
    })
  })

  Object.assign(rt, { imagesForGroup })
}
