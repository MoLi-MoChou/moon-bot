// Relay invites (2026-10-27 remote-agents): the durable half of the relay's auth. A
// token is shown once at creation and stored only as a hash; verifying hashes the
// candidate the same way and compares in constant time. Revocation keeps the row — the
// audit trail is the point — and re-inviting the same agentId replaces the hash.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { SqliteDatabase } from './schema.ts'

export const RelayInviteRow = z.object({
  agentId: z.string(),
  tokenHash: z.string(),
  createdAt: z.number().int(),
  revokedAt: z.number().int().nullable(),
  lastSeenAt: z.number().int().nullable(),
}).readonly()
export type RelayInviteRow = z.infer<typeof RelayInviteRow>

const now = (): number => Date.now()

const hash = (token: string): string => createHash('sha256').update(token).digest('hex')

const rowOf = (row: Record<string, unknown>): RelayInviteRow => RelayInviteRow.parse({
  agentId: row.agent_id,
  tokenHash: row.token_hash,
  createdAt: Number(row.created_at),
  revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
  lastSeenAt: row.last_seen_at === null || row.last_seen_at === undefined ? null : Number(row.last_seen_at),
})

/** The character set avoids look-alikes; 32 chars is 190 bits of it. */
export const newInviteToken = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return [...randomBytes(32)].map(byte => alphabet[byte % alphabet.length]!).join('')
}

export class RelayInvites {
  private readonly db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.db = db
  }

  /** Creates or re-invites; the plaintext token exists only in this return value. */
  create(agentId: string): { readonly row: RelayInviteRow, readonly token: string } {
    const token = newInviteToken()
    const at = now()
    this.db.prepare(`
      INSERT INTO relay_invites (agent_id, token_hash, created_at, revoked_at, last_seen_at)
      VALUES (?, ?, ?, NULL, NULL)
      ON CONFLICT(agent_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, revoked_at = NULL, last_seen_at = NULL
    `).run(agentId, hash(token), at)
    return { row: this.get(agentId) as RelayInviteRow, token }
  }

  get(agentId: string): RelayInviteRow | undefined {
    const row = this.db.prepare('SELECT * FROM relay_invites WHERE agent_id = ?').get(agentId) as Record<string, unknown> | undefined
    return row === undefined ? undefined : rowOf(row)
  }

  list(): RelayInviteRow[] {
    const rows = this.db.prepare('SELECT * FROM relay_invites ORDER BY created_at ASC').all() as Record<string, unknown>[]
    return rows.map(rowOf)
  }

  /** The agentId a live token names, or undefined; a revoked token names nothing. */
  verify(token: string): string | undefined {
    const rows = this.list()
    const candidate = Buffer.from(hash(token))
    const row = rows.find(entry => entry.tokenHash.length === candidate.length && timingSafeEqual(Buffer.from(entry.tokenHash), candidate))
    if (row === undefined || row.revokedAt !== null) return undefined
    return row.agentId
  }

  revoke(agentId: string): boolean {
    const result = this.db.prepare('UPDATE relay_invites SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL').run(now(), agentId)
    return result.changes > 0
  }

  seen(agentId: string): void {
    this.db.prepare('UPDATE relay_invites SET last_seen_at = ? WHERE agent_id = ?').run(now(), agentId)
  }
}
