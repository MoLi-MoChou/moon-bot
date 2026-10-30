// The history page behind the chat's pagers (plan §阶段 3): each stored row becomes the
// session event the client's rows draw. Tool results stay live-view only; a failed turn's
// system row comes back as `turn/error`, the persisted counterpart of the live turn/end
// reason, so the error line survives a reload.
import type { Store } from '../store/db.ts'
import type { PageAnswer, PageRequest } from './context.ts'

/** The page builder the wiring installs with `context.pageWith`. */
export const historyPageOf = (store: Store) => async (input: PageRequest): Promise<PageAnswer> => {
  const sessionId = input.address.sessionId
  const limit = Math.max(1, input.maxMessages ?? 60) + 1
  const rows = store.sessions.pageBetween(sessionId, {
    ...(input.throughSeq !== undefined ? { throughSeq: input.throughSeq } : {}),
    ...(input.beforeSeq !== undefined ? { beforeSeq: input.beforeSeq } : {}),
    limit,
  })
  const max = Math.max(1, input.maxMessages ?? 60)
  const hasMore = rows.length > max
  const shown = hasMore ? rows.slice(0, max) : rows
  return {
    records: shown.flatMap((row): { seq: number, event: { type: string, time: number, data: unknown } }[] => {
      if (row.role === 'user') {
        return [{ seq: row.seq, event: { type: 'user/message', time: row.createdAt, data: { content: row.content, source: row.source } } }]
      }
      if (row.role === 'assistant') {
        return [{ seq: row.seq, event: { type: 'assistant/message', time: row.createdAt, data: { message: { content: row.content }, turn: row.turn ?? undefined } } }]
      }
      // The engine's row for a failed turn: the chat draws it as the error line the live
      // turn/end already showed.
      if (row.role === 'system' && (row.source as { readonly kind?: unknown } | null)?.kind === 'turn-error') {
        const source = row.source as { readonly code?: unknown }
        const text = row.content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')
        return [{
          seq: row.seq,
          event: {
            type: 'turn/error',
            time: row.createdAt,
            data: {
              turn: row.turn ?? undefined,
              error: {
                ...(typeof source.code === 'string' ? { code: source.code } : {}),
                ...(text !== '' ? { message: text } : {}),
              },
            },
          },
        }]
      }
      return []
    }),
    hasMore,
  }
}
