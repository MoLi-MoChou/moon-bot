// The store layer's database entry (plan §阶段 1): one SQLite file under the team home
// holds what JSON state.json cannot serve — the message transcript, the task queue,
// and the memory index. Markdown stays the source of truth for memory; the tables here
// are its index, rebuilt from the files when missing.
//
// `openStore` is the only way in: it opens the file, applies migrations in order, and
// returns the typed handles. Callers close over `close()`; better-sqlite3 is
// synchronous, so one connection per process is the right shape.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS } from './schema.ts'
import { Sessions } from './sessions.ts'
import { Tasks } from './tasks.ts'
import { MemoryIndex } from './memory-index.ts'
import { PolicyCounters } from './policy-counters.ts'

export interface Store {
  readonly raw: Database.Database
  readonly sessions: Sessions
  readonly tasks: Tasks
  readonly memory: MemoryIndex
  readonly policy: PolicyCounters
  close(): void
}

const userVersion = (db: Database.Database): number => {
  const row = db.pragma('user_version', { simple: true })
  return typeof row === 'number' ? row : 0
}

const applyMigrations = (db: Database.Database): void => {
  const from = userVersion(db)
  if (from > MIGRATIONS.length) throw new Error(`store schema is newer than this code knows (v${from} > v${MIGRATIONS.length})`)
  db.transaction(() => {
    for (let index = from; index < MIGRATIONS.length; index += 1) {
      const migration = MIGRATIONS[index]
      if (migration) db.exec(migration.sql)
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`)
  })()
}

/** Opens (and if needed creates) the team store at `<home>/store.sqlite3`. */
export function openStore(home: string, options: { readonly file?: string; readonly readonly?: boolean } = {}): Store {
  mkdirSync(home, { recursive: true })
  const db = new Database(join(home, options.file ?? 'store.sqlite3'), options.readonly === true ? { readonly: true } : {})
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return {
    raw: db,
    sessions: new Sessions(db),
    tasks: new Tasks(db),
    memory: new MemoryIndex(db),
    policy: new PolicyCounters(db),
    close: () => db.close(),
  }
}
