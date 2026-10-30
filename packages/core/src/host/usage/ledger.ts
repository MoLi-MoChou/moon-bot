// Where the usage ledger lives: one SQLite file, or memory when `node:sqlite` is not
// available. A row is one billed call or one metered one; marks say how far each
// Session's log has been read.
import type { DatabaseSync } from 'node:sqlite'
import type { FoldSnapshot, TokenTotals } from './fold.js'

/** The ledger version whose schema this build knows. */
const LEDGER_VERSION = 2
/** Calls are summed per quarter hour, which every time zone offset divides. */
export const SLOT_MS = 15 * 60_000

/** One Session's owner, as the ledger keeps it after that Bot or room is deleted. */
export interface OwnerRecord {
  readonly owner: string
  readonly name: string
}

/** How far one Session's log has been folded. */
export interface LedgerMark {
  readonly through: number
  readonly fold: FoldSnapshot
  readonly sealed: boolean
}

/** One call as the ledger stores it. */
export interface LedgerCall extends TokenTotals {
  readonly key: string
  readonly session: string
  readonly time: number
  readonly provider: string
  readonly model: string
  readonly kind: string
  readonly live?: boolean | undefined
  readonly calls?: number | undefined
}

/** One read of a Session log, and the mark it leaves. */
export interface LedgerCommit {
  readonly rows: readonly LedgerCall[]
  readonly reset: boolean
  readonly mark: LedgerMark
}

/** Calls summed per Session, model, use and quarter hour. */
export interface LedgerGroup {
  readonly session: string
  readonly provider: string
  readonly model: string
  readonly kind: string
  readonly slot: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  calls: number
}

export interface Ledger {
  mark(sessionId: string): LedgerMark | undefined
  commit(sessionId: string, commit: LedgerCommit): void
  add(row: LedgerCall): void
  owners(): Map<string, OwnerRecord>
  setOwner(sessionId: string, owner: OwnerRecord): void
  kinds(): Map<string, string>
  setKind(sessionId: string, kind: string): void
  groups(): readonly LedgerGroup[]
  close(): void
}

// One aggregate per Session, model, use, and quarter hour.
function addTo(groups: Map<string, LedgerGroup>, row: LedgerCall): void {
  const slot = Math.floor(row.time / SLOT_MS)
  const id = `${row.session}\n${row.provider}\n${row.model}\n${row.kind}\n${slot}`
  const group: LedgerGroup = groups.get(id) ?? {
    session: row.session,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    slot,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    calls: 0,
  }
  group.input += row.input
  group.cacheRead += row.cacheRead
  group.cacheWrite += row.cacheWrite
  group.output += row.output
  group.calls += row.calls ?? 1
  groups.set(id, group)
}

export function memoryLedger(): Ledger {
  const calls = new Map<string, LedgerCall>()
  const marks = new Map<string, LedgerMark>()
  const owners = new Map<string, OwnerRecord>()
  const kinds = new Map<string, string>()
  return {
    mark: sessionId => marks.get(sessionId),
    commit(sessionId, { rows, reset, mark }) {
      if (reset) for (const [key, row] of calls) if (row.session === sessionId && row.live !== true) calls.delete(key)
      for (const row of rows) calls.set(row.key, row)
      marks.set(sessionId, mark)
    },
    add: row => {
      calls.set(row.key, { ...row, live: true })
    },
    owners: () => new Map(owners),
    setOwner: (sessionId, owner) => {
      owners.set(sessionId, owner)
    },
    kinds: () => new Map(kinds),
    setKind: (sessionId, kind) => {
      kinds.set(sessionId, kind)
    },
    groups() {
      const groups = new Map<string, LedgerGroup>()
      for (const row of calls.values()) addTo(groups, row)
      return [...groups.values()]
    },
    close: () => {},
  }
}

interface VersionRow {
  readonly user_version?: number
}

interface MarkRow {
  readonly through: number
  readonly fold: string
  readonly sealed: number
}

interface OwnerRow {
  readonly session: string
  readonly owner: string
  readonly name: string
}

interface KindRow {
  readonly session: string
  readonly kind: string
}

interface GroupRow {
  readonly session: string
  readonly provider: string
  readonly model: string
  readonly kind: string
  readonly slot: number
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
  readonly calls: number
}

export function sqliteLedger(DatabaseSync: typeof import('node:sqlite').DatabaseSync, path: string): Ledger {
  const db: DatabaseSync = new DatabaseSync(path)
  try {
    // Desktop and Web may share one the host home; the other writer holds the lock
    // briefly, and the timeout must be armed before the WAL pragma can block.
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    const version = db.prepare('PRAGMA user_version').get() as VersionRow | undefined
    if (version?.user_version !== LEDGER_VERSION) {
      db.exec(`
        DROP TABLE IF EXISTS calls;
        DROP TABLE IF EXISTS marks;
        DROP TABLE IF EXISTS owners;
        DROP TABLE IF EXISTS kinds;
        CREATE TABLE calls (key TEXT PRIMARY KEY, session TEXT NOT NULL, time INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, kind TEXT NOT NULL, live INTEGER NOT NULL, input INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, output INTEGER NOT NULL);
        CREATE INDEX calls_session ON calls (session);
        CREATE TABLE marks (session TEXT PRIMARY KEY, through INTEGER NOT NULL, fold TEXT NOT NULL, sealed INTEGER NOT NULL);
        CREATE TABLE owners (session TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL);
        CREATE TABLE kinds (session TEXT PRIMARY KEY, kind TEXT NOT NULL);
        PRAGMA user_version = ${LEDGER_VERSION};`)
    }
    const put = db.prepare(
      'INSERT OR REPLACE INTO calls (key, session, time, provider, model, kind, live, input, cache_read, cache_write, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const dropLogged = db.prepare('DELETE FROM calls WHERE session = ? AND live = 0')
    const getMark = db.prepare('SELECT through, fold, sealed FROM marks WHERE session = ?')
    const setMark = db.prepare('INSERT OR REPLACE INTO marks (session, through, fold, sealed) VALUES (?, ?, ?, ?)')
    const allOwners = db.prepare('SELECT session, owner, name FROM owners')
    const putOwner = db.prepare('INSERT OR REPLACE INTO owners (session, owner, name) VALUES (?, ?, ?)')
    const allKinds = db.prepare('SELECT session, kind FROM kinds')
    const putKind = db.prepare('INSERT OR REPLACE INTO kinds (session, kind) VALUES (?, ?)')
    const grouped = db.prepare(
      `SELECT session, provider, model, kind, time / ${SLOT_MS} AS slot, SUM(input) AS input, SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(output) AS output, COUNT(*) AS calls FROM calls GROUP BY session, provider, model, kind, slot`,
    )
    const insert = (row: LedgerCall, live: boolean): void => {
      put.run(
        row.key,
        row.session,
        row.time,
        row.provider,
        row.model,
        row.kind,
        live ? 1 : 0,
        row.input,
        row.cacheRead,
        row.cacheWrite,
        row.output,
      )
    }
    return {
      mark(session) {
        const row = getMark.get(session) as MarkRow | undefined
        return row === undefined
          ? undefined
          : { through: row.through, fold: JSON.parse(row.fold) as FoldSnapshot, sealed: row.sealed === 1 }
      },
      commit(session, { rows, reset, mark }) {
        db.exec('BEGIN')
        try {
          if (reset) dropLogged.run(session)
          for (const row of rows) insert(row, false)
          setMark.run(session, mark.through, JSON.stringify(mark.fold), mark.sealed ? 1 : 0)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      add: row => insert(row, true),
      owners: () =>
        new Map(
          (allOwners.all() as unknown as readonly OwnerRow[]).map((row): [string, OwnerRecord] => [
            row.session,
            { owner: row.owner, name: row.name },
          ]),
        ),
      setOwner: (session, owner) => {
        putOwner.run(session, owner.owner, owner.name)
      },
      kinds: () =>
        new Map(
          (allKinds.all() as unknown as readonly KindRow[]).map((row): [string, string] => [row.session, row.kind]),
        ),
      setKind: (session, kind) => {
        putKind.run(session, kind)
      },
      groups: () => (grouped.all() as unknown as readonly GroupRow[]).map(row => ({ ...row, slot: Number(row.slot) })),
      close: () => db.close(),
    }
  } catch (error) {
    db.close()
    throw error
  }
}
