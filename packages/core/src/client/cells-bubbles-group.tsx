import { createElement as h } from 'react'
import { inkText } from './inks.ts'
import { BotMark, colorOf } from './mark.tsx'
import { t } from './i18n.ts'
import { clockLabel, elapsedLabel, messageClock } from './text.ts'
import type { ChatBot, GroupMessageProps, GroupReply, ReplyBlock } from './cells-bubbles-types.ts'
import { Bubbles } from './cells-bubbles-ui.tsx'

export function GroupMessage({
  bot,
  text = '',
  texts = [text],
  room,
  roster,
  actions,
  msgKey,
  useUi,
  whole,
  time,
  duration,
}: GroupMessageProps) {
  const memberBots =
    room?.members.map(id => roster.byId[id]).filter((item): item is ChatBot => item !== undefined) ?? roster.bots
  const lead = (
    <button
      type='button'
      className='bt-lead'
      aria-label={t("Open {name}'s chat", { name: bot.name })}
      onClick={() => actions.openSession(bot.id)}>
      <BotMark bot={bot} size={22} />
    </button>
  )
  const took = duration !== undefined && Number.isFinite(duration) ? elapsedLabel(duration) : undefined
  return (
    <div className='bt-group-msg'>
      <span className='bt-group-name' style={{ color: inkText(colorOf(bot)) }}>
        {bot.name}
        {room?.admin === bot.id ? <span className='bt-group-role'>{t('Admin')}</span> : null}
        {time !== undefined && Number.isFinite(time) ? (
          <span className='bt-group-time' title={clockLabel(time)}>
            {messageClock(time)}
          </span>
        ) : null}
        {took ? (
          <span className='bt-group-took' title={t('Ran for {duration}', { duration: took })}>
            {took}
          </span>
        ) : null}
      </span>
      <Bubbles
        texts={texts}
        roster={roster}
        selfId={bot.id}
        actions={actions}
        sessionId={room?.id}
        msgKey={msgKey}
        useUi={useUi}
        lead={lead}
        whole={whole}
        mentionBots={memberBots}
        everyoneBots={room ? memberBots : undefined}
      />
    </div>
  )
}
// A member's messages in a row, as one block under its name: what it says while it
// works comes one message at a time. A block carries the last message's time and run.
export function stackReplies(replies: readonly GroupReply[]): ReplyBlock[] {
  const items: ReplyBlock[] = []
  replies.forEach((reply, index) => {
    const last = items.at(-1)
    if (
      reply.kind === undefined &&
      last !== undefined &&
      last.reply.kind === undefined &&
      last.reply.botId === reply.botId
    ) {
      last.texts.push(reply.text)
      last.time = reply.time
      last.duration = reply.duration
    } else
      items.push({
        reply,
        index,
        texts: reply.kind === undefined ? [reply.text] : [],
        time: reply.time,
        duration: reply.duration,
      })
  })
  return items
}
