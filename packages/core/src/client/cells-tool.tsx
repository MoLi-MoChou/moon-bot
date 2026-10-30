import { Fragment, createElement as h } from 'react'
import { isHiddenTurn, toolArgs, toolName } from './text.ts'
import type { ChatBot } from './cells-bubbles.tsx'
import { useLiveNote } from './cells-rows.tsx'
import { CARDS, DRAWN, callTree, lastRunning } from './cells-turns.tsx'
import { useShownCards } from './cells-tool-helpers.ts'
import type { CallEnv, ToolCellProps } from './cells-tool-types.ts'
import { toolActivity } from './cells-tool-phrases.ts'
import { renderCall } from './cells-tool-call.tsx'

export type {
  WorkDoing,
  WorkState,
  WorkHook,
  ToolActivity,
  ToolNode,
  ToolCellProps,
} from './cells-tool-types.ts'
export { PHRASES, workPhrase } from './cells-tool-phrases.ts'

export function ToolCell({ node, sessionId, useRoster, useUi, useWork, useHeldCards, actions }: ToolCellProps) {
  const roster = useRoster(value => value)
  const heldCards = useHeldCards?.(state => state[sessionId])
  const root = node.data.root
  const turn = node.location?.turn?.turn ?? root.turn
  const hidden = isHiddenTurn(roster, sessionId, turn)
  const findBot = (nameOrId?: string): ChatBot | undefined =>
    roster.byId[nameOrId ?? ''] ??
    roster.bots.find(bot => bot.name.toLowerCase() === String(nameOrId ?? '').toLowerCase())
  const calls = hidden ? [] : callTree(root)
  const drawn = calls.filter(call => {
    const name = toolName(call)
    return name !== undefined && DRAWN.has(name)
  })
  // The newest call still running names the work, so a program reads as the tool it is in.
  const running = root.kind === 'tool-result' ? undefined : lastRunning(calls)
  const note = running ? toolActivity(toolName(running), toolArgs(running).text, findBot, roster.byId[sessionId]) : null
  // A running tool shows only as the activity row's phrase.
  useLiveNote(actions, sessionId, `tool:${root.callId ?? node.key}`, note)
  useShownCards(
    actions,
    sessionId,
    drawn.flatMap(call => {
      const name = toolName(call)
      return name !== undefined && CARDS.has(name) && call.callId ? [call.callId] : []
    }),
  )
  if (drawn.length === 0) return null
  const env: CallEnv = {
    sessionId,
    roster,
    actions,
    useUi,
    useWork,
    findBot,
    heldCards,
    turnKey: turn === undefined ? undefined : `${sessionId}:${turn}`,
  }
  return (
    <>
      {drawn.map(call => (
        <>{renderCall(call, env)}</>
      ))}
    </>
  )
}
