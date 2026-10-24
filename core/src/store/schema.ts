// The store schema, as ordered migrations (plan §阶段 1: sessions/messages/tasks/
// memory index, Zod-modelled in the table modules). Append only: a migration that ran
// never changes; the next change is a new entry at the end and `user_version` moves on.

export interface Migration {
  readonly name: string
  readonly sql: string
}

// v1 — the standalone runtime's four table groups.
const V1 = `
-- One row per session the roster owns: a Bot's own chat, a group's session, an agent.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- 'bot' | 'group' | 'agent'
  owner_id TEXT NOT NULL,         -- bot id, room id, or agent id
  title TEXT,
  model TEXT,
  effort TEXT,
  system_prompt TEXT,             -- the stable base; the frozen memory segment is built per turn
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sessions_owner ON sessions(owner_id);

-- The transcript: every message a session sent or received, in order.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,           -- per-session order, gapless enough to page by
  turn INTEGER,                   -- the turn the message belongs to, when there was one
  role TEXT NOT NULL,             -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,          -- JSON: EngineContentBlock[]
  source TEXT,                    -- JSON: the delivery source, for user messages
  stop_reason TEXT,               -- JSON: EngineStopReason, for the message that ended a turn
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX messages_session ON messages(session_id, seq);

-- Durable work: scheduled triggers and in-flight follow-ups survive a restart here.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- 'schedule' | 'work' | 'followup'
  owner_session TEXT,             -- the session that runs or answers it
  payload TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'done' | 'failed' | 'paused'
  next_run_at INTEGER,            -- when the scheduler may fire it (cron/interval resolved ahead)
  attempts INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,               -- JSON of the last outcome, for follow-up and audit
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_due ON tasks(state, next_run_at);

-- The memory index: one row per live memory entry, mirrored from the Markdown files.
CREATE TABLE memory_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,            -- 'bot:<id>' | 'room:<id>' | 'team'
  entry_key TEXT NOT NULL,        -- the entry's own key in its Markdown file
  topic TEXT,                     -- the topic file it lives in, when there is one
  text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  valid_until INTEGER,            -- epoch ms; NULL means no expiry
  superseded_by INTEGER,          -- row id of the correcting entry, when corrected
  source TEXT,                    -- JSON: where it came from (conversation, schedule, user)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(scope, entry_key)
);
CREATE INDEX memory_live ON memory_index(scope, active);

-- Full-text search over live memory text; trigram keeps Chinese searchable.
CREATE VIRTUAL TABLE memory_fts USING fts5(
  text,
  content='memory_index',
  content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER memory_ai AFTER INSERT ON memory_index BEGIN
  INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER memory_ad AFTER DELETE ON memory_index BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER memory_au AFTER UPDATE OF text ON memory_index BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text);
END;
`

// v2 — the engine replays a session's transcript through the kernel's own message
// format; the structured columns stay the queryable projection of it.
const V2 = 'ALTER TABLE messages ADD COLUMN raw TEXT;'

export const MIGRATIONS: readonly Migration[] = [
  { name: 'v1 standalone store', sql: V1 },
  { name: 'v2 raw kernel messages', sql: V2 },
]

/** The type the table modules see: a better-sqlite3 connection. */
export type SqliteDatabase = import('better-sqlite3').Database
