// Memory: what a Bot keeps across all its conversations, as Markdown in the Agent
// Memory Repo format (github.com/AgentMemoryRepo/agentmemoryrepo): one entry per
// bullet line ending in `[key: value; …]` metadata, and a MEMORY.md entry point whose
// `## Index` links topic files as [[topic]].
//
//   <home>/memory/bots/<botId>/    a Bot's own MEMORY.md and topics
//   <home>/memory/groups/<roomId>/ what the members of one group chat share there
//   <home>/memory/team/            what every Bot reads
//   <home>/memory/journal.jsonl    every change, with the line before and after
//   <home>/memory/snapshots/       the memory section each Session froze
//   <home>/memory/summaries/       the memory panel's summary per Bot or group chat
//   <home>/memory/archive/         the memory of deleted Bots and group chats
//   <home>/memory/reviewed.json    how far the memory review has read each conversation
//
// Files change in place and the journal keeps what each change replaced, so history
// needs no git. Bots change memory through remember and forget, which enforce who may
// write where, the fixed sizes, and that no key is kept; the memory review after each
// turn, and the memory panel for the user, go through the same path. The review is
// what keeps memory from depending on a Bot deciding to call remember. What is said in
// a group chat stays in that group: its review keeps it in the group's memory, which
// only the members read, and only in their conversations there. Writes run one at a
// time, in the process that holds the team (store.ts). Each Session freezes its
// memory section the first time it renders, so its prompt stays byte-stable and the
// provider's prefix cache holds; a fresh part, or a checkpoint (which breaks the cache
// anyway), freezes it anew.
//
// The public surface stays here; the format is in memory/records.ts, storage in
// memory/storage.ts, prompts in memory/prompt.ts, the review in memory/news.ts, and
// the read paths in memory/recall.ts.
import type { Caller } from './memory/recall.ts'
import type { MemoryActor, MemoryScope } from './memory/records.ts'

export interface WriteOk {
  readonly caller: Caller
  readonly scope: MemoryScope
  readonly actor: MemoryActor
  readonly label: string
}

export {
  MEMORY_LIMITS,
  addLink,
  cleanEntry,
  cleanTopic,
  formatEntry,
  insertEntry,
  looksLikeKey,
  looksSecret,
  matchEntries,
  parseMemory,
  removeLink,
  splitMeta,
} from './memory/records.ts'

export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

export interface TopicChoice {
  readonly topic?: string | undefined
  readonly error?: string | undefined
}

export interface WriteError {
  readonly error: string
}
// A reply cut off at the limit is tried once more with room for reasoning plus
// the answer; a model that thinks can spend the smaller budget thinking alone.
export const SUMMARY_RETRY_MAX_TOKENS = 8_192

export const MODEL_TIMEOUT_MS = 120_000

export type WriteContext = WriteOk | WriteError
export { parseAsk, parseReview, reviewEntries, writtenIn } from './memory/prompt.ts'
export const SUMMARY_MAX_TOKENS = 2_048
export const REVIEW_DELAY_MS = 2_000
