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

// v3 — the policy ledger: one counter per session and risk level per UTC day.
const V3 = `
CREATE TABLE policy_counters (
  day INTEGER NOT NULL,            -- UTC day, floor(epoch / 86400000)
  session_id TEXT NOT NULL,
  level INTEGER NOT NULL,          -- 3 or 4
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(day, session_id, level)
);
`

// v4 — relay invites (2026-10-27 remote-agents): one row per remote agent ever invited.
// The token itself is never stored, only its hash; a revoked invite stays for the audit
// trail, and the same agentId can be invited again after a revoke.
const V4 = `
CREATE TABLE relay_invites (
  agent_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER
);
`

// v5 — deliverables (2026-10-28 files-and-library): the files a turn left behind in the
// Bot's workspace, collected at turn end. A side table, not a message field: the chat
// reads it by session and turn, the library page reads it across sessions, and the
// messages' shape stays untouched.
const V5 = `
CREATE TABLE deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn INTEGER,
  name TEXT NOT NULL,
  path TEXT NOT NULL,            -- workspace-relative; the UI never sees an absolute path
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX deliverables_turn ON deliverables(session_id, turn);
CREATE INDEX deliverables_age ON deliverables(created_at);
`

// v6 — proactive messages (2026-10-29 proactive-messages): a user's subscription to a
// Bot's own messages, and one row per candidate it prepared and what was decided.
// The decision log is what the de-duplication window reads: both delivered and rejected
// candidates are kept, so the same thing is not said twice and a rejected subject stays
// quiet for the window rather than coming back tomorrow.
const V6 = `
CREATE TABLE proactive_subscriptions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  topics TEXT NOT NULL,            -- free text the user wrote: what this is about
  when_json TEXT NOT NULL,         -- the scheduler's selector, as it stores one
  daily_cap INTEGER NOT NULL DEFAULT 1,
  quiet_from TEXT,                 -- 'HH:MM' local, null when the user cleared it
  quiet_to TEXT,
  allow_paid_prep INTEGER NOT NULL DEFAULT 0,
  event_hook TEXT,                 -- 'no-progress' for the one hook v1 has
  event_minutes INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX proactive_subscriptions_bot ON proactive_subscriptions(bot_id);

CREATE TABLE proactive_candidates (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES proactive_subscriptions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,              -- the one sentence the user would read
  evidence TEXT NOT NULL,          -- JSON array of lines, each naming its source
  why_care TEXT NOT NULL,
  ttl TEXT NOT NULL,               -- 'short' or 'long'
  topic_keys TEXT NOT NULL,        -- JSON array of normalized keywords, for similarity
  fingerprint TEXT NOT NULL,       -- exact-text hash, the cheap first pass
  trigger_source TEXT NOT NULL,    -- 'schedule' | 'event' | 'manual' | 'preauth'
  created_at INTEGER NOT NULL
);
CREATE INDEX proactive_candidates_subscription ON proactive_candidates(subscription_id, created_at);

CREATE TABLE proactive_decisions (
  candidate_id TEXT PRIMARY KEY REFERENCES proactive_candidates(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,          -- 'delivered' | 'quiet' | 'dropped' | 'delayed'
  reason TEXT,
  decided_at INTEGER NOT NULL
);
CREATE INDEX proactive_decisions_age ON proactive_decisions(decided_at);
`

export const MIGRATIONS: readonly Migration[] = [
  { name: 'v1 standalone store', sql: V1 },
  { name: 'v2 raw kernel messages', sql: V2 },
  { name: 'v3 policy counters', sql: V3 },
  { name: 'v4 relay invites', sql: V4 },
  { name: 'v5 deliverables', sql: V5 },
  { name: 'v6 proactive messages', sql: V6 },
]

/** The type the table modules see: a better-sqlite3 connection. */
export type SqliteDatabase = import('better-sqlite3').Database
