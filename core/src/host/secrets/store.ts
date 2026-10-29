// The secret records and the file they live in. A value is written only to
// secrets.json (mode 600); the team state keeps the pending cards and the list the
// browser shows, never the value.
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceFile } from '../files.ts'
import type { HostRuntime } from '../runtime.js'
import { MIN_VALUE, MAX_VALUE, SECRET_NAME, canUse, envName, type SecretScope } from './redact.ts'

const MAX_REQUESTS = 20
const USED_SAVE_MS = 5000

/** One stored secret; `value` is what the shell and the redactor use. */
export interface SecretRecord {
  readonly name: string
  value: string
  purpose: string
  scope: SecretScope
  readonly requestedBy: string | null
  readonly createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

/** What the browser may see: the same record without its value. */
export interface SecretView {
  readonly name: string
  readonly purpose: string
  readonly scope: SecretScope
  readonly requestedBy: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt?: number
}

export type SecretRequestStatus = 'pending' | 'saved' | 'allowed' | 'canceled'

/** One card a Bot asked for, kept in `state.secretRequests`. */
export interface SecretRequest {
  readonly id: string
  readonly callId?: string
  readonly sessionId: string | undefined
  readonly name: string
  readonly purpose: string
  kind: 'fill' | 'allow'
  status: SecretRequestStatus
  readonly askedAt: number
  settledAt?: number
  scope?: SecretScope
}

/** One `[botId, text]` note to deliver once a change is saved. */
export type SecretNote = [string, string]

/** A secrets endpoint request, from a card or the settings page. */
export interface SecretBody {
  readonly requestId?: unknown
  readonly name?: unknown
  readonly value?: unknown
  readonly purpose?: unknown
  readonly scope?: unknown
}

/** The store surface the installer wires endpoints, tools and listeners against. */
export interface SecretStore {
  readonly secrets: Map<string, SecretRecord>
  load(): Promise<void>
  persist(): Promise<void>
  noteUsed(): void
  dispose(): void
  requestsOf(botId: string): SecretRequest[]
  findRequest(id: string): { readonly botId: string; readonly request: SecretRequest } | undefined
  pendingRequest(id: unknown): { readonly botId: string; readonly request: SecretRequest }
  trimRequests(list: SecretRequest[]): void
  settle(request: SecretRequest, status: SecretRequestStatus): void
  reconcile(name: string, notes: SecretNote[], except?: SecretRequest): void
  /** Adds `botId` to a list scope; `canUse` is false for `'all'` when the id is a string. */
  allowBot(secret: SecretRecord, botId: string): void
  commit(notes: SecretNote[]): Promise<void>
  tell(botId: string, text: string): Promise<void>
  forgetBotSecrets(botId: string): Promise<void>
  cleanValue(raw: unknown): string
  cleanScope(raw: unknown): SecretScope
  secretView(secret: SecretRecord): SecretView
  secretsView(): SecretView[]
  scopeText(scope: SecretScope): string
  usage(name: string): string
  savedNote(name: string, lead: string): string
}

// Error messages from JSON.parse quote the file, so only the code or name is logged.
const reason = (error: unknown): string => {
  const value = error as { readonly code?: unknown; readonly name?: unknown } | null | undefined
  return String(value?.code ?? value?.name ?? 'error')
}

const storedRecords = (parsed: unknown): SecretRecord[] => {
  const secrets = parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { readonly secrets?: unknown }).secrets)
    ? (parsed as { readonly secrets: unknown[] }).secrets
    : []
  const records: SecretRecord[] = []
  for (const entry of secrets) {
    const raw = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    if (typeof raw.name !== 'string' || !SECRET_NAME.test(raw.name) || typeof raw.value !== 'string') continue
    records.push({
      name: raw.name,
      value: raw.value,
      purpose: typeof raw.purpose === 'string' ? raw.purpose : '',
      scope: raw.scope === 'all' ? 'all' : Array.isArray(raw.scope) ? raw.scope.filter((id): id is string => typeof id === 'string') : 'all',
      requestedBy: typeof raw.requestedBy === 'string' ? raw.requestedBy : null,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      ...(typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt) ? { lastUsedAt: raw.lastUsedAt } : {}),
    })
  }
  return records
}

class SecretStoreImpl implements SecretStore {
  readonly secrets = new Map<string, SecretRecord>()
  private readonly path: string
  private loaded: Promise<void> | null = null
  private loadedReadOnly = false
  private writing: Promise<void> = Promise.resolve()
  private usedTimer: ReturnType<typeof setTimeout> | null = null

  private readonly rt: HostRuntime
  private readonly changed: () => void

  constructor(rt: HostRuntime, changed: () => void) {
    this.rt = rt
    this.changed = changed
    this.path = join(rt.home, 'secrets.json')
  }

  // While another instance holds the team, that host writes secrets.json, so a reading host
  // reads it again each time; a copy read then is also read again after taking over,
  // before this host saves anything.
  load(): Promise<void> {
    if (this.loaded !== null && (this.loadedReadOnly || this.rt.readOnly() !== undefined)) this.loaded = null
    this.loaded ??= this.read()
    return this.loaded
  }

  private async read(): Promise<void> {
    this.loadedReadOnly = this.rt.readOnly() !== undefined
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      const records = storedRecords(parsed)
      this.secrets.clear()
      for (const record of records) this.secrets.set(record.name, record)
      if (!this.loadedReadOnly) await chmod(this.path, 0o600).catch(() => {})
    } catch (error) {
      if ((error as { readonly code?: unknown } | null | undefined)?.code === 'ENOENT') this.secrets.clear()
      else this.rt.warn('moon-bot: unreadable secrets file %s (%s)', this.path, reason(error))
    }
    this.changed()
  }

  // Resolves once secrets.json holds the current map; rejects when the write failed.
  persist(): Promise<void> {
    const readOnly = this.rt.readOnly()
    if (readOnly !== undefined) return Promise.reject(new Error(readOnly))
    const snapshot = JSON.stringify({ version: 1, secrets: [...this.secrets.values()] }, null, 2)
    const job = this.writing.then(async (): Promise<void> => {
      await mkdir(this.rt.home, { recursive: true })
      const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 })
        await chmod(temp, 0o600)
        await replaceFile(temp, this.path)
      } catch (error) {
        await unlink(temp).catch(() => {})
        throw error
      }
    })
    this.writing = job.catch((error: unknown) => this.rt.warn('moon-bot: secrets write failed (%s)', reason(error)))
    return job
  }

  noteUsed(): void {
    if (this.usedTimer !== null) return
    this.usedTimer = setTimeout(() => {
      this.usedTimer = null
      if (this.loadedReadOnly || this.rt.readOnly() !== undefined) return
      void this.persist().then(() => this.rt.save()).catch(() => {})
    }, USED_SAVE_MS)
    this.usedTimer.unref?.()
  }

  dispose(): void {
    if (this.usedTimer !== null) clearTimeout(this.usedTimer)
  }

  // A Bot's pending secret cards, keyed by its id. A key that is not a real Bot (and
  // never an inherited name like "__proto__", which a plain assignment would not even
  // set as a key) gets a throwaway list instead of a stored one.
  requestsOf(botId: string): SecretRequest[] {
    const requests = (this.rt.state.secretRequests ??= {})
    if (!Object.hasOwn(requests, botId) && this.rt.botOf(botId) === undefined) return []
    return (requests[botId] ??= [])
  }

  findRequest(id: string): { readonly botId: string; readonly request: SecretRequest } | undefined {
    for (const [botId, list] of Object.entries(this.rt.state.secretRequests ?? {})) {
      const request = list.find(entry => entry.id === id)
      if (request !== undefined) return { botId, request }
    }
    return undefined
  }

  pendingRequest(id: unknown): { readonly botId: string; readonly request: SecretRequest } {
    const found = this.findRequest(String(id ?? ''))
    if (found === undefined) throw new Error('This request is gone')
    if (found.request.status !== 'pending') throw new Error('This request was already answered')
    return found
  }

  trimRequests(list: SecretRequest[]): void {
    while (list.length > MAX_REQUESTS) {
      const settled = list.findIndex(entry => entry.status !== 'pending')
      list.splice(settled === -1 ? 0 : settled, 1)
    }
  }

  settle(request: SecretRequest, status: SecretRequestStatus): void {
    request.status = status
    request.settledAt = Date.now()
    if (status === 'saved' || status === 'allowed') request.scope = this.secrets.get(request.name)?.scope ?? 'all'
  }

  // After any change to `name`, every pending card for it either resolves (its Bot can
  // use the key now) or shows the form that still applies.
  reconcile(name: string, notes: SecretNote[], except?: SecretRequest): void {
    const secret = this.secrets.get(name)
    for (const [botId, list] of Object.entries(this.rt.state.secretRequests ?? {})) {
      for (const request of list) {
        if (request.status !== 'pending' || request.name !== name || request === except) continue
        if (canUse(secret, botId)) {
          this.settle(request, 'saved')
          notes.push([botId, this.savedNote(name, `The user saved ${name}, and you may use it now.`)])
        } else {
          request.kind = secret !== undefined ? 'allow' : 'fill'
        }
      }
    }
  }

  allowBot(secret: SecretRecord, botId: string): void {
    secret.scope = [...new Set([...(secret.scope === 'all' ? [] : secret.scope), botId])]
  }

  async commit(notes: SecretNote[]): Promise<void> {
    this.changed()
    await this.persist()
    await this.rt.save()
    for (const [botId, text] of notes) await this.tell(botId, text)
  }

  async tell(botId: string, text: string): Promise<void> {
    if (this.rt.botOf(botId) === undefined) return
    await this.rt.deliver({ toId: botId, role: 'secret', text })
      .catch((error: unknown) => this.rt.warn('moon-bot: secret note to %s failed: %s', botId, error))
  }

  // A deleted Bot leaves every list it was on, and its cards go with it.
  async forgetBotSecrets(botId: string): Promise<void> {
    await this.load()
    if (this.rt.state.secretRequests !== undefined) delete this.rt.state.secretRequests[botId]
    let touched = false
    for (const secret of this.secrets.values()) {
      if (Array.isArray(secret.scope) && secret.scope.includes(botId)) {
        secret.scope = secret.scope.filter(id => id !== botId)
        touched = true
      }
    }
    if (touched) {
      this.changed()
      await this.persist().catch(() => {})
    }
  }

  cleanValue(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('Type the key first')
    const value = raw.trim()
    if (value.length < MIN_VALUE) throw new Error(`A key must have at least ${MIN_VALUE} characters`)
    if (value.length > MAX_VALUE) throw new Error(`A key can have at most ${MAX_VALUE} characters`)
    return value
  }

  cleanScope(raw: unknown): SecretScope {
    if (raw === 'all') return 'all'
    if (!Array.isArray(raw)) throw new Error('Choose every Bot or a list of Bots')
    return [...new Set(raw.filter((id): id is string => typeof id === 'string' && this.rt.botOf(id) !== undefined))]
  }

  secretView(secret: SecretRecord): SecretView {
    return {
      name: secret.name,
      purpose: secret.purpose,
      scope: secret.scope,
      requestedBy: secret.requestedBy,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      ...(secret.lastUsedAt !== undefined ? { lastUsedAt: secret.lastUsedAt } : {}),
    }
  }

  secretsView(): SecretView[] {
    return [...this.secrets.values()].sort((a, b) => a.name.localeCompare(b.name)).map(secret => this.secretView(secret))
  }

  scopeText(scope: SecretScope): string {
    if (scope === 'all') return 'every Bot'
    const names = scope.map(id => this.rt.botOf(id)?.name).filter((name): name is string => Boolean(name))
    return names.length === 0 ? 'no Bot' : names.join(', ')
  }

  usage(name: string): string {
    return `$${envName(name)} in bash, or $env:${envName(name)} in PowerShell`
  }

  savedNote(name: string, lead: string): string {
    return [
      `${lead} Use it as ${this.usage(name)}.`,
      'You cannot see the value. Never print, echo, or log it, and never ask the user to paste it into the chat. Carry on with what you needed it for.',
    ].join(' ')
  }
}

export const createSecretStore = (rt: HostRuntime, changed: () => void): SecretStore => new SecretStoreImpl(rt, changed)
