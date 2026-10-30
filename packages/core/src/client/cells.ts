// The transcript cells: bubbles and their tools, thinking rows, group messages and
// events, earlier parts, chat rows, the turn trigger/process/tail cells, shimmer and
// elapsed, tool phrases, group replies, call trees, and the dock-card logic.
//
// The implementation is split across the modules beside this one so each stays under the
// line gate; this module keeps the names the client imports, so every caller still reads
// the transcript from `cells.ts`.
export { clockLabel } from './text.ts'
export { Bubbles, stackReplies } from './cells-bubbles.tsx'
export { ThinkingRow, AssistantCell, forgetMemoryLines } from './cells-rows.tsx'
export { ChatRows, Elapsed, Shimmer, stackChatItems } from './cells-chat.tsx'
export { TriggerCell, TurnProcessCell, Nothing, TurnTailCell, callTree, openingTurn, unseenSince } from './cells-turns.tsx'
export { PHRASES, ToolCell, workPhrase } from './cells-tool.tsx'
