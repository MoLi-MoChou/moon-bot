// Usage ledger: the tokens each model call in the host spent, for the Usage page.
//
// A call that a Session logs (one assistant settlement per attempt) is read from that
// log, so calls made before this ledger existed count too. A call outside every log (a
// checkpoint, a handoff note, the steward, an image reading, the host titles and compaction)
// is metered while it streams, from the time DS Bot runs. Rows go to usage.sqlite; like
// the chat index it is derived from the logs, and deleting it loses only the metered
// calls and the names of deleted Bots.
//
// A call belongs to a Bot (its own chat, its group Sessions, their earlier parts, and
// any Session forked or spawned under them), to a group chat's own Session, or to the
// rest of the host ("other").
export { foldCalls, tokensOf } from './usage/fold.ts'
export type { FoldSnapshot, FoldState, FoldedCall, FoldedRow, RetryState, TokenTotals } from './usage/fold.ts'
export { install } from './usage/install.ts'
export type { UsageModel, UsageOwner, UsageRow, UsageView, UsageViewOptions } from './usage/view.ts'
