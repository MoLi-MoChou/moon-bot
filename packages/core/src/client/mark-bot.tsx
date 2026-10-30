import { createElement as h, useEffect, useRef, useState } from 'react'
import { fnv1a, lookOf, shapeId, shapeOf, MASK_ID, nextMarkSerial, characterMarkup } from './characters.ts'
import type { LookBot } from './characters.ts'
import { t } from './i18n.ts'
// The look a mark draws: a character shape, an optional photo, and a colour.
export type Look = {
  shape: string
  image?: string | undefined
  color: string
}
export interface MarkBot extends LookBot {
  id?: string
}
export interface BotMarkProps {
  bot?: MarkBot | undefined
  look?: Look | undefined
  size?: number | undefined
  state?: string | undefined
  live?: boolean | undefined
  gaze?: boolean | undefined
  pokeable?: boolean | undefined
  label?: string | undefined
}
export interface BotAvatarProps {
  bot?: MarkBot | undefined
  size?: number | undefined
  state?: string | undefined
  main?: boolean | undefined
  admin?: boolean | undefined
  badge?: boolean | undefined
  live?: boolean | undefined
  gaze?: boolean | undefined
  pokeable?: boolean | undefined
}
export interface RoomAvatarProps {
  room: {
    members: readonly string[]
  }
  roster: {
    byId: Record<string, MarkBot | undefined>
  }
  size?: number
}
export { colorOf, lookOf } from './characters.ts'
// -------------------------------------------------------------------------
// Bot mark: the Bot's character (or its uploaded photo), looked up by lookOf.
// Mascot states: what the Bot is doing picks the
// motion. Uploaded images only bob or hop, since they have no parts to move. `waiting`:
// no turn runs, but work it handed on has not come back yet.
const STATES = ['idle', 'thinking', 'searching', 'working', 'sending', 'orbit', 'waiting', 'alert', 'done']
export const botState = (running: boolean, activity: unknown, alert: boolean): string =>
  running
    ? typeof activity === 'string' && STATES.includes(activity) && activity !== 'waiting'
      ? activity
      : 'working'
    : alert
      ? 'alert'
      : activity === 'waiting'
        ? 'waiting'
        : 'idle'
export const toolState = (name: string): string =>
  /^(message_bot|stop_bot|create_bot|update_bot|create_group|update_group|delete_group|post_to_group)$/.test(name)
    ? 'sending'
    : /search|fetch|browse|read|grep|glob|list|recall/i.test(name)
      ? 'searching'
      : 'working'
// Eyes follow the pointer on large marks.
function useGaze(ref: React.RefObject<HTMLSpanElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined
    let frame = 0
    let point: {
      x: number
      y: number
    } | null = null
    const place = () => {
      frame = 0
      const node = ref.current
      if (!node || !point) return
      const box = node.getBoundingClientRect()
      const clamp = (value: number) => Math.max(-1, Math.min(1, value))
      node.style.setProperty('--bt-gx', clamp((point.x - box.left - box.width / 2) / 160).toFixed(2))
      node.style.setProperty('--bt-gy', clamp((point.y - box.top - box.height / 2) / 160).toFixed(2))
    }
    const onMove = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY }
      if (!frame) frame = requestAnimationFrame(place)
    }
    const onLeave = () => {
      point = null
      ref.current?.style.setProperty('--bt-gx', '0')
      ref.current?.style.setProperty('--bt-gy', '0')
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [enabled])
}
// A mark moves for its state. `live` marks (sidebar, header, details) also answer the
// pointer, and at the lively motion level blink and fidget at rest (each Bot its own
// fidget and moment); transcript marks stay still so a long chat does not run dozens
// of animations.
const FIDGETS = ['hop', 'sway', 'stretch', 'look']
export function BotMark({
  bot,
  look: given,
  size = 36,
  state = 'idle',
  live = false,
  gaze = false,
  pokeable = false,
  label,
}: BotMarkProps) {
  const look: Look = given ?? lookOf(bot)
  const ref = useRef<HTMLSpanElement | null>(null)
  const maskId = useRef('')
  if (maskId.current === '') maskId.current = `bt-mark-${nextMarkSerial()}`
  const [poked, setPoked] = useState(false)
  // A photo that does not load shows the character instead; a new photo is tried again.
  const [broken, setBroken] = useState('')
  const image = look.image && look.image !== broken ? look.image : undefined
  useGaze(ref, gaze)
  const common: Record<string, unknown> = {
    ref,
    className: poked ? 'bt-mark bt-mark-poke' : 'bt-mark',
    'data-shape': image ? 'image' : shapeId(look.shape),
    'data-state': STATES.includes(state) ? state : 'idle',
    'data-live': live ? '' : undefined,
    'data-fidget': live ? FIDGETS[fnv1a(`${bot?.id ?? ''}:fidget`) % FIDGETS.length] : undefined,
    'data-gaze': gaze ? '' : undefined,
    'data-poke': pokeable ? '' : undefined,
    style: {
      width: size,
      height: size,
      ...(live
        ? {
            '--bt-delay': `${-(fnv1a(String(bot?.id ?? '')) % 5000) / 1000}s`,
            '--bt-fidget-delay': `${-(fnv1a(`${bot?.id ?? ''}:when`) % 9000) / 1000}s`,
          }
        : {}),
    },
    role: label ? 'img' : undefined,
    'aria-label': label,
    'aria-hidden': label ? undefined : true,
    onClick: pokeable ? () => setPoked(true) : undefined,
    onAnimationEnd: poked
      ? (event: React.AnimationEvent<HTMLSpanElement>) => {
          if (event.animationName.startsWith('bt-poke')) setPoked(false)
        }
      : undefined,
  }
  const props = common as React.HTMLAttributes<HTMLSpanElement>
  if (image)
    return (
      <span {...props}>
        <img className='bt-mark-img' src={image} alt='' draggable={false} onError={() => setBroken(image)} />
      </span>
    )
  const box = shapeOf(look.shape).size
  return (
    <span {...props}>
      <svg
        viewBox={`0 0 ${box} ${box}`}
        dangerouslySetInnerHTML={{
          __html: characterMarkup(look.shape, look.color).replaceAll(MASK_ID, maskId.current),
        }}
      />
    </span>
  )
}
function StarIcon({ size = 8 }: { size?: number | undefined }) {
  return (
    <svg width={size} height={size} viewBox='0 0 10 10' aria-hidden>
      <path d='M5 .6l1.3 2.8 3 .3-2.3 2 .7 3L5 7.2 2.3 8.7l.7-3L.7 3.7l3-.3z' fill='#fff' />
    </svg>
  )
}
// The small star in a disc that marks a group admin, beside a name.
export function AdminStar() {
  return (
    <span className='bt-admin-star' role='img' aria-label={t('Admin')}>
      <StarIcon size={7} />
    </span>
  )
}
// A Main Bot wears a large solid star; a group admin wears the small star in a disc.
function MainStar() {
  return (
    <svg viewBox='0 0 20 20' aria-hidden>
      <path d='M10 2.4l2.29 5.04 5.51.63-4.09 3.74 1.11 5.42L10 14.5l-4.82 2.73 1.11-5.42L2.2 8.07l5.51-.63z' />
    </svg>
  )
}
// Marks settle with a short squash when a run finishes.
function useSettled(state: string): boolean {
  const prev = useRef(state)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const was = prev.current
    prev.current = state
    if (state !== 'idle') {
      setSettled(false)
      return undefined
    }
    if (was === 'idle' || was === 'alert') return undefined
    setSettled(true)
    const timer = setTimeout(() => setSettled(false), 1800)
    return () => clearTimeout(timer)
  }, [state])
  return settled
}
export function BotAvatar({
  bot,
  size,
  state = 'idle',
  main,
  admin,
  badge = true,
  live = true,
  gaze = false,
  pokeable = false,
}: BotAvatarProps) {
  const settled = useSettled(state)
  if (bot === undefined) return <BotMark size={size} />
  const badgeKind = !badge
    ? null
    : state === 'alert'
      ? 'alert'
      : state !== 'idle' && state !== 'waiting'
        ? 'working'
        : admin
          ? 'admin'
          : main
            ? 'main'
            : null
  return (
    <span className='bt-mark' style={{ width: size, height: size, '--bt-size': `${size}px` }}>
      <BotMark bot={bot} size={size} state={settled ? 'done' : state} live={live} gaze={gaze} pokeable={pokeable} />
      {badgeKind === 'working' ? (
        <span className='bt-badge bt-badge-working' aria-label={t('Working')} role='img' />
      ) : null}
      {badgeKind === 'alert' ? (
        <span className='bt-badge bt-badge-alert' aria-label={t('Waiting for your answer')} role='img'>
          ?
        </span>
      ) : null}
      {badgeKind === 'admin' ? (
        <span className='bt-badge bt-badge-admin' aria-label={t('Admin')} role='img'>
          <StarIcon />
        </span>
      ) : null}
      {badgeKind === 'main' ? (
        <span className='bt-badge bt-badge-main' aria-label={t('Main Bot')} role='img'>
          <MainStar />
        </span>
      ) : null}
    </span>
  )
}
// A group avatar seats its members' characters in the frame: two on a
// diagonal, three in a triangle, four in a grid, and past four three plus a "+N" seat.
