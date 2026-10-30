import { createElement as h } from 'react'
import { t } from './i18n.ts'
import { PendingQuestion, SettledQuestion } from './questions.tsx'
import type { QuestionAnswer } from './questions.tsx'
import { contentText, toolArgs, toolName } from './text.ts'
import { SecretToolCell } from './secret-card.tsx'
import { WidgetCell } from './widget-cell.tsx'
import { heldCardKey } from './sources.ts'
import { EventLine, GroupEvent } from './cells-chat.tsx'
import { MemoryEvent } from './cells-rows.tsx'
import type { ChatCall } from './cells-turns.tsx'
import type { CallEnv } from './cells-tool-types.ts'
import { GroupReplies } from './cells-tool-group.tsx'
import { groupVerb } from './cells-tool-helpers.ts'

export function renderCall(
  call: ChatCall,
  { sessionId, roster, actions, useUi, useWork, findBot, heldCards, turnKey }: CallEnv,
) {
  const tool = toolName(call)
  const done = call.kind === 'tool-result'
  const { text: arg, value: argValue } = toolArgs(call)
  const self = roster.byId[sessionId]
  switch (tool) {
    case 'message_bot': {
      const target = findBot(arg('to')) ?? { name: arg('to') ?? '…', color: 'gray' }
      if (done && call.isError)
        return <div className='bt-event'>{t("Couldn't message {name}", { name: target.name })}</div>
      return (
        <EventLine
          prefix={t('Messaged')}
          bots={[target]}
          onOpen={bot => {
            if (bot.id) actions.openExchange(self?.id ?? sessionId, bot.id)
          }}
          whole
        />
      )
    }
    case 'stop_bot': {
      const target = findBot(arg('bot')) ?? { name: arg('bot') ?? '…', color: 'gray' }
      if (done && call.isError)
        return <div className='bt-event'>{t("Couldn't stop {name}", { name: target.name })}</div>
      return (
        <EventLine
          prefix={t('Stopped')}
          bots={[target]}
          onOpen={bot => {
            if (bot.id) actions.openExchange(self?.id ?? sessionId, bot.id)
          }}
          whole
        />
      )
    }
    case 'create_bot': {
      const created = findBot(arg('name'))
      if (!done || created === undefined) return null
      return <EventLine prefix={t('Created')} bots={[created]} onOpen={bot => actions.openSession(bot.id)} />
    }
    case 'update_bot': {
      const target = findBot(arg('name')) ?? findBot(arg('bot')) ?? (arg('bot') ? undefined : self)
      return done && target ? (
        <EventLine prefix={t('Updated')} bots={[target]} onOpen={bot => actions.openSession(bot.id)} />
      ) : null
    }
    case 'group_relay':
      return (
        <GroupReplies
          sessionId={sessionId}
          callId={call.callId}
          done={done}
          content={call.content}
          roster={roster}
          actions={actions}
          useUi={useUi}
          useWork={useWork}
        />
      )
    case 'create_group':
    case 'update_group':
    case 'delete_group':
    case 'post_to_group': {
      const verbs = groupVerb(tool)
      if (!done) return null
      // Tool results quote the group's name; anything else is a refusal.
      const result = contentText(call.content)
      const named = /^(Created group|Updated|Nothing changed in|Deleted|Posted in) "([^"]+)"/.exec(result)
      if (call.isError || !named)
        return (
          <div className='bt-event' title={result}>
            {t(verbs[1])}
          </div>
        )
      const name = named[2]
      const room = roster.rooms.find(entry => entry.name === name)
      return (
        <GroupEvent
          prefix={t(verbs[0])}
          room={tool === 'delete_group' ? undefined : room}
          name={name}
          roster={roster}
          actions={actions}
        />
      )
    }
    case 'ask_user': {
      const question = roster.questions?.[sessionId]
      // Answered or closed: the card leaves no gap where it was.
      if (!question || question.callId !== call.callId) return <span className='bt-q-gone' hidden />
      if ((heldCards?.[heldCardKey('question', question.id)] ?? 0) > 0) return null
      return (
        <PendingQuestion
          key={JSON.stringify([sessionId, question.id])}
          sessionId={sessionId}
          question={question}
          actions={actions}
          inline
        />
      )
    }
    case 'show_view':
      // The cell's arguments reader forwards the tool's accessor unchanged, as the JS did;
      // its declared type says a key never misses, which the host's arguments do not promise.
      return (
        <WidgetCell
          sessionId={sessionId}
          callId={call.callId ?? ''}
          args={{ text: arg, value: argValue } as Parameters<typeof WidgetCell>[0]['args']}
          done={done}
          isError={call.isError ?? false}
          roster={roster}
          actions={actions}
          heldCards={heldCards}
        />
      )
    case 'request_secret':
      return (
        <SecretToolCell
          sessionId={sessionId}
          callId={call.callId ?? ''}
          name={arg('name')}
          done={done}
          content={call.content}
          roster={roster}
          actions={actions}
          heldCards={heldCards}
        />
      )
    case 'ask_user_question': {
      if (!done) return null
      let parsed: {
        answers?: readonly QuestionAnswer[]
      } | null = null
      try {
        parsed = JSON.parse(contentText(call.content))
      } catch {
        parsed = null
      }
      const answer = parsed?.answers?.[0]
      const questions = argValue('questions')
      const question = Array.isArray(questions) ? questions[0] : undefined
      if (!answer) return null
      return (
        <div className='bt-q-inline'>
          <SettledQuestion question={question} answer={answer} />
        </div>
      )
    }
    case 'read_group_chat': {
      if (!done) return null
      const room = roster.rooms.find(entry => entry.name === arg('group'))
      return room ? <GroupEvent prefix={t('Read')} room={room} roster={roster} actions={actions} /> : null
    }
    case 'remember':
    case 'forget':
      return done && !call.isError ? (
        <MemoryEvent
          sessionId={sessionId}
          scope={arg('scope')}
          result={contentText(call.content)}
          roster={roster}
          actions={actions}
          findBot={findBot}
          turnKey={turnKey}
          callId={call.callId}
        />
      ) : null
    default:
      return null
  }
}
