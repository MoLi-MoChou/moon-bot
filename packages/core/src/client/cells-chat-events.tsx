import { createElement as h, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { t } from './i18n.ts'
import { elapsedLabel } from './text.ts'
import { BotMark, RoomAvatar } from './mark.tsx'
import type { CellActions, ChatRoom, ChatRoster } from './cells-bubbles.tsx'
import type { ElapsedProps, ShimmerProps } from './cells-chat-types.ts'

export interface EventBot {
  id?: string
  name: string
  color?: unknown
  avatar?: unknown
}
interface MarkProps {
  name: string
  id?: string
  color?: unknown
  avatar?: unknown
}
/** The mark props of an event Bot: no id property when the Bot had none. */
const markOf = (bot: EventBot): MarkProps =>
  bot.id === undefined
    ? { name: bot.name, color: bot.color, avatar: bot.avatar }
    : { name: bot.name, id: bot.id, color: bot.color, avatar: bot.avatar }
export interface EventLineProps {
  prefix: string
  bots: readonly EventBot[]
  joiner?: string
  onOpen?: ((bot: EventBot) => void) | undefined
  whole?: boolean
}
export function EventLine({ prefix, bots, joiner = t('and'), onOpen, whole = false }: EventLineProps) {
  const only = bots[0]
  if (whole && bots.length === 1 && only !== undefined) {
    return (
      <div className='bt-event'>
        <button type='button' className='bt-event-whole' title={only.name} onClick={() => onOpen?.(only)}>
          <span>{prefix}</span>
          <BotMark bot={markOf(only)} size={16} />
          <span className='bt-event-name'>{only.name}</span>
        </button>
      </div>
    )
  }
  const parts: ReactNode[] = []
  parts.push(<span key='p'>{prefix}</span>)
  bots.forEach((bot, index) => {
    if (index > 0) parts.push(<span key={`j${index}`}>{joiner}</span>)
    parts.push(
      <button key={bot.id ?? index} type='button' onClick={() => onOpen?.(bot)}>
        <BotMark bot={markOf(bot)} size={16} />
        {bot.name}
      </button>,
    )
  })
  return <div className='bt-event'>{parts}</div>
}
export interface GroupEventProps {
  prefix: string
  room?: ChatRoom | undefined
  name?: string | undefined
  roster: ChatRoster
  actions: CellActions
}
// A centered event line that names a group chat and opens it.
export function GroupEvent({ prefix, room, name, roster, actions }: GroupEventProps) {
  return (
    <div className='bt-event'>
      <span>{prefix}</span>
      {room ? (
        <button type='button' onClick={() => actions.openSession(room.id)}>
          <RoomAvatar room={room} roster={roster} size={16} />
          {room.name}
        </button>
      ) : name ? (
        <span>{name}</span>
      ) : null}
    </div>
  )
}
export function Shimmer({ children }: ShimmerProps) {
  return <span className='bt-shimmer'>{children}</span>
}
// The time since `at`, from 1s. It ticks on its own whole seconds, so its parent does
// not render again each second.
export function Elapsed({ at, className }: ElapsedProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      const time = Date.now()
      setNow(time)
      timer = setTimeout(tick, 1000 - ((((time - at) % 1000) + 1000) % 1000))
    }
    tick()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [at])
  return <span className={className}>{`· ${elapsedLabel(Math.max(1000, now - at))}`}</span>
}
