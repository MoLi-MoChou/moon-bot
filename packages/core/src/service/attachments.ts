// The standalone attachments store (plan §阶段 3): files under `<home>/attachments/`,
// content-addressed, with a small index file naming each. The surface is the one the
// host modules already speak (saveFile/readFileStream), so long messages, images and
// file deliveries keep working without the host's attachment service.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AttachmentRef, AttachmentsService } from '../host/host-types.js'

const INDEX = 'index.json'

interface IndexEntry {
  readonly name: string
  readonly bytes: number
}

const readIndex = (file: string): Record<string, IndexEntry> => {
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, IndexEntry> = {}
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const view = entry as { name?: unknown; bytes?: unknown }
      if (typeof view?.name === 'string')
        out[id] = { name: view.name, bytes: typeof view.bytes === 'number' ? view.bytes : 0 }
    }
    return out
  } catch {
    return {}
  }
}

export class FileAttachments implements AttachmentsService {
  private readonly dir: string

  constructor(home: string) {
    this.dir = join(home, 'attachments')
    mkdirSync(this.dir, { recursive: true })
  }

  async saveFile(input: { readonly data: Uint8Array; readonly name: string }): Promise<AttachmentRef> {
    const attachmentId = `sha256:${createHash('sha256').update(input.data).digest('hex')}`
    const file = join(this.dir, attachmentId.replace(/^sha256:/, ''))
    if (!existsSync(file)) {
      writeFileSync(`${file}.tmp`, input.data)
      renameSync(`${file}.tmp`, file)
    }
    const indexFile = join(this.dir, INDEX)
    const index = readIndex(indexFile)
    index[attachmentId] = { name: input.name, bytes: input.data.byteLength }
    writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
    return { attachmentId, name: input.name, bytes: input.data.byteLength }
  }

  async *readFileStream(ref: AttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const id = ref.attachmentId.replace(/^sha256:/, '')
    // Only what this store saved; a path never escapes the attachments directory.
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('no such attachment')
    const file = join(this.dir, id)
    if (!existsSync(file)) throw new Error('no such attachment')
    const stream = createReadStream(file, { signal })
    for await (const chunk of stream) yield chunk as Buffer
  }

  /** A saved file's name, for the views that list attachments. */
  nameOf(ref: AttachmentRef): string | undefined {
    return readIndex(join(this.dir, INDEX))[ref.attachmentId]?.name
  }
}
