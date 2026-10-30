import { createElement as h, useEffect, useState } from 'react'
import { MarkdownText } from './primitives.tsx'
import { failureLabel } from './diagnostics.ts'
import { t } from './i18n.ts'
import { BotMark, toolState } from './mark.tsx'
import { contentText, messageClock, clockLabel } from './text.ts'
import { GroupMessage, mdLabels, stackReplies } from './cells-bubbles.tsx'
import { Shimmer } from './cells-chat.tsx'
import type { GroupRepliesProps, LiveReplies } from './cells-tool-types.ts'
import { workPhrase } from './cells-tool-phrases.ts'

export function GroupReplies({ sessionId, callId, done, content, roster, actions, useUi, useWork }: GroupRepliesProps) {
  const [live, setLive] = useState<LiveReplies>({ replies: [], speaking: null })
  useEffect(() => {
    if (done) return undefined
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let seen = ''
    const tick = async (): Promise<void> => {
      const result = await actions.roomProgress(sessionId)
      if (stop) return
      const entry = (result ?? []).find(item => item.callId === callId) ?? (result ?? [])[0]
      const key = entry ? JSON.stringify([entry.replies, entry.speaking]) : ''
      if (entry && key !== seen) {
        seen = key
        setLive({ replies: entry.replies ?? [], speaking: entry.speaking ?? null })
      }
      timer = setTimeout(tick, document.hidden ? 5000 : 1000)
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [done, sessionId, callId])
  let replies = live.replies
  if (done) {
    try {
      replies = JSON.parse(contentText(content)).replies ?? []
    } catch {
      replies = []
    }
  }
  // Members speak one at a time, so only the current speaker is typing.
  const pending = done || !live.speaking ? [] : [live.speaking]
  const speaker = live.speaking === null ? undefined : live.speaking
  const speakerTool = useWork?.(work => (speaker === undefined ? undefined : work.bots?.[speaker]?.tool)) ?? undefined
  const speakerDoing =
    useWork?.(work => {
      const bot = speaker === undefined ? undefined : work.bots?.[speaker]
      return bot?.tool ? workPhrase(bot) : undefined
    }) ?? undefined
  if (replies.length === 0 && pending.length === 0) return null
  const room = roster.roomsById[sessionId]
  return (
    <div className='bt-group-replies'>
      {stackReplies(replies).map(({ reply, index, texts, time, duration }) => {
        const bot = roster.byId[reply.botId] ?? { id: reply.botId, name: reply.name, color: reply.color ?? 'gray' }
        if (reply.kind === 'user') {
          return (
            <div key={`user-${index}`} className='bt-urow'>
              <div className='bt-ububble'>
                <MarkdownText text={reply.text} labels={mdLabels()} variant='compact' />
                {time !== undefined && Number.isFinite(time) ? (
                  <div className='bt-utime' title={clockLabel(time)}>
                    {messageClock(time)}
                  </div>
                ) : null}
              </div>
            </div>
          )
        }
        if (reply.kind === 'failed') {
          return (
            <div
              key={`${reply.botId}-${index}`}
              className='bt-event bt-event-error'
              role='status'
              title={[reply.code, reply.status, reply.text].filter(Boolean).join(' · ')}>
              {t('{name} could not answer: {reason}', {
                name: bot.name,
                reason: failureLabel(reply.code ?? t('Unknown error'), reply.text),
              })}
            </div>
          )
        }
        if (reply.kind === 'lookup') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              {reply.text
                ? t('{name} looked up its own chat for “{text}”', { name: bot.name, text: reply.text })
                : t('{name} looked up its own chat', { name: bot.name })}
            </div>
          )
        }
        if (reply.kind === 'missed') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              {t("{name} didn't answer in time", { name: bot.name })}
            </div>
          )
        }
        if (reply.kind === 'resumed') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              {t('{name} was cut off by a restart and picked its work back up', { name: bot.name })}
            </div>
          )
        }
        if (reply.kind === 'cut') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              {t('{name} was cut off by a restart again and stopped', { name: bot.name })}
            </div>
          )
        }
        if (reply.kind === 'approval' || reply.kind === 'working') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              <button type='button' className='bt-event-whole' onClick={() => actions.showDetails(sessionId)}>
                <BotMark bot={bot} size={16} />
                <span className='bt-event-name'>
                  {t(reply.kind === 'working' ? '{name} started on it' : '{name} paused for your approval', {
                    name: bot.name,
                  })}
                </span>
              </button>
            </div>
          )
        }
        if (reply.kind === 'stopped') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              {t("You stopped {name}'s work", { name: bot.name })}
            </div>
          )
        }
        if (reply.kind === 'done') {
          return (
            <div key={`${reply.botId}-${index}`} className='bt-event'>
              {t('{name} finished its work', { name: bot.name })}
            </div>
          )
        }
        return (
          <GroupMessage
            key={`${reply.botId}-${index}`}
            bot={bot}
            texts={texts}
            room={room}
            roster={roster}
            actions={actions}
            msgKey={callId ? `${sessionId}:${callId}:${index}` : undefined}
            useUi={useUi}
            time={time}
            duration={duration}
          />
        )
      })}
      {pending.map(id => {
        const bot = roster.byId[id]
        if (!bot) return null
        return (
          <div key={`pending-${id}`} className='bt-activity'>
            <BotMark bot={bot} size={22} state={speakerTool ? toolState(speakerTool) : 'thinking'} />
            <Shimmer>
              {speakerDoing ? `${bot.name} · ${speakerDoing}…` : t('{name} is typing…', { name: bot.name })}
            </Shimmer>
          </div>
        )
      })}
    </div>
  )
}
// Tells the docks which card calls the transcript draws, so a card shows in one place.
// A layout effect: an untouched dock drops its copy before the first paint.
