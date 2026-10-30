import { createElement as h } from 'react'
import { contentText, currentPart } from './text.ts'
import { t } from './i18n.ts'
import { heldCardKey } from './sources.ts'
import type { CardsHook, SecretActions, SecretRequest, SecretRoster } from './secret-card-types.ts'
import { NONE } from './secret-card-types.ts'
import { KeyIcon } from './secret-card-input.tsx'
import { RequestView, SecretCard } from './secret-card-form.tsx'

export type SecretContent = Parameters<typeof contentText>[0]

export interface SecretToolCellProps {
  sessionId: string
  callId: string
  name?: string | undefined
  done?: boolean | undefined
  content?: SecretContent
  roster: SecretRoster
  actions: SecretActions
  heldCards?: Record<string, number> | undefined
}
// The card at its request_secret call; a key that was already there gets one line.
export function SecretToolCell({
  sessionId,
  callId,
  name,
  done,
  content,
  roster,
  actions,
  heldCards = NONE,
}: SecretToolCellProps) {
  const bot = roster.byId[sessionId]
  if (!bot) return null
  // Call ids repeat across a Bot's chat parts.
  const request = (roster.secretRequests?.[bot.id] ?? []).find(
    entry => entry.callId === callId && (entry.sessionId ?? sessionId) === sessionId,
  )
  if (request?.status === 'pending' && (heldCards[heldCardKey('secret', request.id)] ?? 0) > 0) return null
  if (request)
    return (
      <div className='bt-q-inline'>
        <RequestView sessionId={sessionId} bot={bot} request={request} roster={roster} actions={actions} />
      </div>
    )
  if (done && /already saved/.test(contentText(content))) {
    return (
      <div className='bt-event'>
        <span className='bt-secret-event'>
          <KeyIcon />
          {t('{bot} is using {name}', { bot: bot.name, name: name ?? t('a saved key') })}
        </span>
      </div>
    )
  }
  return null
}
export interface SecretDockProps {
  sessionId: string
  useRoster: <T>(select: (roster: SecretRoster) => T) => T
  useCards?: CardsHook | undefined
  useHeldCards?: CardsHook | undefined
  actions: SecretActions
}
// A card whose call the transcript does not draw (an earlier part of the chat, a
// hidden turn, a call outside the loaded history) waits above the composer instead.
// Once editing starts it keeps that component until completion or cancellation.
export function SecretDock({ sessionId, useRoster, useCards, useHeldCards, actions }: SecretDockProps) {
  const roster = useRoster(value => value)
  const shown = useCards?.(state => state[sessionId]) ?? NONE
  const held = useHeldCards?.(state => state[sessionId]) ?? NONE
  const bot = roster.byId[sessionId]
  if (!bot || currentPart(bot) !== sessionId) return null
  const drawn = (entry: SecretRequest): boolean =>
    entry.callId !== undefined &&
    entry.callId !== '' &&
    entry.sessionId === sessionId &&
    (shown[entry.callId] ?? 0) > 0 &&
    !((held[heldCardKey('secret', entry.id)] ?? 0) > 0)
  const waiting = (roster.secretRequests?.[bot.id] ?? []).filter(entry => entry.status === 'pending' && !drawn(entry))
  if (waiting.length === 0) return null
  return (
    <div className='bt-q-dock bt-secret-dock'>
      {waiting.map(request => (
        <SecretCard
          key={JSON.stringify([sessionId, request.id, request.kind])}
          sessionId={sessionId}
          bot={bot}
          request={request}
          roster={roster}
          actions={actions}
        />
      ))}
    </div>
  )
}
