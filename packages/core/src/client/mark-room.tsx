import { createElement as h } from 'react'
import type React from 'react'
import { BotMark, type MarkBot, type RoomAvatarProps } from './mark-bot.tsx'

function clusterSeats(count: number, frame: number): [number, number, number][] {
  if (count === 1) return [[0, 0, frame]]
  if (count === 2)
    return [
      [0, 0, (frame * 2) / 3],
      [frame / 3, frame / 3, (frame * 2) / 3],
    ]
  if (count === 3) {
    const size = (frame * 5) / 9
    const rest = frame - size
    return [
      [rest / 2, 0, size],
      [0, rest, size],
      [rest, rest, size],
    ]
  }
  const half = frame / 2
  return [
    [0, 0, half],
    [half, 0, half],
    [0, half, half],
    [half, half, half],
  ]
}
export function RoomAvatar({ room, roster, size = 36 }: RoomAvatarProps) {
  const members = room.members.map(id => roster.byId[id]).filter((bot): bot is MarkBot => bot !== undefined)
  // A group with one Bot left shows the user beside it.
  const people: (MarkBot | null)[] = members.length === 1 ? [members[0] ?? null, null] : members
  const seat = (bot: MarkBot | null | undefined, seatSize: number, key?: string) =>
    bot ? (
      <BotMark key={key} bot={bot} size={seatSize} />
    ) : (
      <span
        key={key}
        className='bt-cluster-you'
        style={{ width: seatSize * 0.92, height: seatSize * 0.92, margin: seatSize * 0.04 }}
      />
    )
  if (people.length === 0) return <BotMark size={size} />
  // Inline sizes have no room for a cluster, so the members line up instead.
  if (size <= 20 && people.length > 1) {
    return (
      <span className='bt-stack' style={{ '--bt-stack-size': `${size}px` }}>
        {people.slice(0, 3).map((bot, index) => seat(bot, size, bot?.id ?? `you-${index}`))}
        {people.length > 3 ? <span className='bt-stack-more'>{`+${people.length - 3}`}</span> : null}
      </span>
    )
  }
  const seats = clusterSeats(Math.min(people.length, 4), size)
  const overflow = people.length > 4 ? people.length - 3 : 0
  // A later seat cuts a gap of frame/14 into each seat it overlaps.
  const gap = size / 14
  const rings = seats.map(([x, y, s]) => ({ cx: x + s / 2, cy: y + s / 2, r: s * 0.48 + gap }))
  return (
    <span className='bt-cluster' style={{ width: size, height: size }}>
      {seats.map(([x, y, s], index) => {
        const holes = rings
          .slice(index + 1)
          .filter(ring => Math.hypot(ring.cx - x - s / 2, ring.cy - y - s / 2) < ring.r + s * 0.46)
          .map(
            ring =>
              `radial-gradient(circle at ${ring.cx - x}px ${ring.cy - y}px,transparent ${ring.r}px,#000 ${ring.r + 0.5}px)`,
          )
        const style: React.CSSProperties = { left: x, top: y, width: s, height: s }
        if (holes.length > 0)
          Object.assign(style, {
            WebkitMaskImage: holes.join(','),
            maskImage: holes.join(','),
            WebkitMaskComposite: 'source-in',
            maskComposite: 'intersect',
          })
        if (overflow > 0 && index === 3) {
          return (
            <span
              key='more'
              className='bt-cluster-more'
              style={{
                ...style,
                width: s * 0.92,
                height: s * 0.92,
                margin: s * 0.04,
                fontSize: Math.max(8, Math.round(s * 0.36)),
              }}>{`+${overflow}`}</span>
          )
        }
        const bot = people[index]
        return (
          <span key={bot?.id ?? 'you'} style={style}>
            {seat(bot, s)}
          </span>
        )
      })}
    </span>
  )
}
