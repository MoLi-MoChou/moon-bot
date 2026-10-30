import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import { CloseIcon, CheckIcon } from './icons.tsx'
import { t } from './i18n.ts'
import { useDockHold } from './card-hold.ts'
import { heldCardKey } from './sources.ts'
import type { QuestionOption, Question, QuestionAnswer, QuestionActions, PendingAsk, AnsweredNode } from './questions-types.ts'
export type { QuestionOption, Question, QuestionAnswer, QuestionActions, AnsweredNode } from './questions-types.ts'

export const keyLetter = (index: number): string => String.fromCharCode(65 + index)
const optionsOf = (question: Question | undefined): QuestionOption[] => (question?.options ?? []).map(option => (typeof option === 'string' ? { label: option } : option))
const isTypingTarget = (node: unknown): boolean => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || (node instanceof HTMLElement && node.isContentEditable)
// A bare letter picks that option and the letter after the last one
// jumps to the custom answer; never while typing or while a dialog is open.
export function useOptionKeys(count: number, onPick: (index: number) => void, ownRef: React.RefObject<HTMLElement | null>): void {
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    if (count === 0) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.length !== 1) return
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return
      if (document.querySelector('[role="dialog"], [aria-modal="true"]') !== null) return
      const index = event.key.toUpperCase().charCodeAt(0) - 65
      if (index >= 0 && index < count) {
        event.preventDefault()
        pick.current(index)
      } else if (index === count && ownRef.current) {
        event.preventDefault()
        ownRef.current.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [count, ownRef])
}
// A question shows two ways: as a bubble in the transcript, and raised when it
// sits in the dock above the composer.
function QuestionView({ question, onAnswer, onDismiss, onInteract, busy = false, ownAnswer = false, raised = false }: { question: Question; onAnswer: (answer: QuestionAnswer) => void; onDismiss?: (() => void) | undefined; onInteract?: (() => void) | undefined; busy?: boolean; ownAnswer?: boolean; raised?: boolean }) {
  const [own, setOwn] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const ownRef = useRef<HTMLTextAreaElement | null>(null)
  const titleId = useId()
  const options = optionsOf(question)
  const multi = question.multiSelect === true
  const custom = own.trim()
  const canSubmit = multi ? picked.length > 0 || custom !== '' : custom !== ''
  const choose = (label: string) => {
    if (busy) return
    onInteract?.()
    if (multi) {
      setPicked(current => (current.includes(label) ? current.filter(item => item !== label) : [...current, label]))
      return
    }
    onAnswer({ selected: [label] })
  }
  const submit = () => {
    if (!canSubmit || busy) return
    onInteract?.()
    onAnswer({ selected: multi ? picked : [], ...(custom ? { custom } : {}) })
  }
  useOptionKeys(
    busy ? 0 : options.length,
    index => {
      const option = options[index]
      if (option) choose(option.label)
    },
    ownRef,
  )
  const ownLetter = options.length > 0 ? keyLetter(options.length) : undefined
  const field = ownAnswer ? (
    <textarea
      ref={ownRef}
      rows={1}
      value={own}
      readOnly={busy}
      autoComplete='off'
      spellCheck={false}
      className='bt-q-input'
      aria-label={t('Your own answer')}
      placeholder={t('Type your own answer')}
      aria-keyshortcuts={ownLetter?.toLowerCase()}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!busy) {
          onInteract?.()
          setOwn(event.target.value)
        }
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        submit()
      }}
    />
  ) : null
  const rows: ReturnType<typeof h>[] = options.map((option, optionIndex) => {
    const selected = multi && picked.includes(option.label)
    return (
      <button key={option.label} type='button' className='bt-q-opt' disabled={busy} aria-pressed={multi ? selected : undefined} aria-keyshortcuts={keyLetter(optionIndex).toLowerCase()} onClick={() => choose(option.label)}>
        <span className='bt-key' aria-hidden>
          {keyLetter(optionIndex)}
        </span>
        <span className='bt-q-body'>
          <span className='bt-q-label'>{option.label}</span>
          {option.description ? <span className='bt-q-desc'>{option.description}</span> : null}
        </span>
        {selected && !raised ? (
          <span className='bt-q-check' title={t('Selected')}>
            <CheckIcon />
          </span>
        ) : null}
      </button>
    )
  })
  // Raised cards keep the custom answer as one more keyed row; bubbles put it below the list.
  if (raised && field) {
    rows.push(
      <label key='own' className='bt-q-opt bt-q-ownrow' data-filled={custom !== '' ? '' : undefined}>
        {ownLetter ? (
          <span className='bt-key' aria-hidden>
            {ownLetter}
          </span>
        ) : null}
        <span className='bt-q-body'>{field}</span>
      </label>,
    )
  }
  let foot = null
  if (raised && multi) {
    foot = (
      <div className='bt-q-foot'>
        <button type='button' className='bt-q-btn' onClick={onDismiss} disabled={busy}>
          {t('Skip')}
        </button>
        <button type='submit' className='bt-q-submit' disabled={!canSubmit || busy}>
          {t('Submit')}
        </button>
      </div>
    )
  } else if ((raised || multi) && canSubmit) {
    foot = (
      <div className='bt-q-foot'>
        <button type='submit' className='bt-q-submit' disabled={busy}>
          {t('Submit')}
        </button>
      </div>
    )
  }
  return (
    <form
      className={raised ? 'bt-q bt-q-raised' : 'bt-q'}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onFocusCapture={onInteract}
      onPointerDownCapture={onInteract}
      onKeyDown={(event: React.KeyboardEvent<HTMLFormElement>) => {
        if (event.key === 'Escape' && !busy && onDismiss) {
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
        }
      }}
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault()
        submit()
      }}>
      <div className='bt-q-head'>
        <div className='bt-q-text'>
          <p className='bt-q-title' id={titleId}>
            {question.header ? `${question.header} · ` : ''}
            {question.question}
          </p>
          {question.detail ? <div className='bt-q-detail'>{question.detail}</div> : null}
          {raised && multi ? <div className='bt-q-detail'>{t('Choose all that apply')}</div> : null}
        </div>
        <button type='button' className='bt-q-x' aria-label={t('Dismiss question')} title={t('Dismiss')} onClick={onDismiss} disabled={busy}>
          <CloseIcon />
        </button>
      </div>
      {rows.length > 0 ? (
        <div className='bt-q-list' role='group'>
          {rows}
        </div>
      ) : null}
      {field && !raised ? (
        <div className='bt-q-custom'>
          <label className='bt-q-field'>{field}</label>
          {!multi && canSubmit ? (
            <button type='submit' className='bt-q-submit' disabled={busy}>
              {t('Submit')}
            </button>
          ) : null}
        </div>
      ) : null}
      {foot}
    </form>
  )
}
// The answered card left in the transcript: the chosen rows, muted, with a check.
export function SettledQuestion({ question, answer }: { question: Question; answer: QuestionAnswer }) {
  const options = optionsOf(question)
  const prompt = question?.question ?? ''
  const chosen = [...(answer.selected ?? []), ...(answer.custom ? [answer.custom] : [])]
  if (chosen.length === 0) {
    return (
      <div className='bt-q bt-q-settled bt-q-dismissed' role='group' aria-label={prompt}>
        <div className='bt-q-head'>
          <div className='bt-q-text'>
            <p className='bt-q-title'>{prompt}</p>
          </div>
          <span className='bt-q-badge'>{t('Dismissed')}</span>
        </div>
      </div>
    )
  }
  return (
    <div className='bt-q bt-q-settled' role='group' aria-label={prompt}>
      {prompt ? (
        <div className='bt-q-head'>
          <div className='bt-q-text'>
            <p className='bt-q-title'>{prompt}</p>
          </div>
        </div>
      ) : null}
      <div className='bt-q-list' role='group' aria-label={t('Your answer')}>
        {chosen.map((label, index) => {
          const optionIndex = options.findIndex(option => option.label === label)
          return (
            <div key={`${label}-${index}`} className='bt-q-opt'>
              {optionIndex >= 0 ? (
                <span className='bt-key' aria-hidden>
                  {keyLetter(optionIndex)}
                </span>
              ) : null}
              <span className='bt-q-body'>
                <span className='bt-q-label'>{label}</span>
              </span>
              <span className='bt-q-check' title={t('Selected')}>
                <CheckIcon />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
export function QuestionCard({ matched }: { matched: PendingAsk }) {
  const pending = matched
  const questions = pending.questions ?? []
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<
    (QuestionAnswer & {
      id: string
    })[]
  >([])
  const question = questions[index]
  if (question === undefined) return null
  const onAnswer = (answer: QuestionAnswer) => {
    const next = [...answers, { id: question.id, ...answer }]
    if (index + 1 < questions.length) {
      setAnswers(next)
      setIndex(index + 1)
      return
    }
    pending.answer({ answers: next })
  }
  return <QuestionView key={index} question={question} onAnswer={onAnswer} onDismiss={() => pending.dismiss()} ownAnswer raised />
}
export function PendingQuestion({ sessionId, question, actions, inline }: { sessionId: string; question: Question; actions: QuestionActions; inline: boolean }) {
  const [answered, setAnswered] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const hold = useDockHold(sessionId, 'question', question.id, actions, inline)
  if (answered === question.id) return null
  const run = (make: () => Promise<unknown>) => {
    if (busyRef.current) return
    hold()
    busyRef.current = true
    setBusy(true)
    // Keep QuestionView mounted until success: a failed request must not erase
    // the selected options, custom answer, or focused field.
    void Promise.resolve()
      .then(make)
      .then(
        () => setAnswered(question.id),
        () => setAnswered(null),
      )
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }
  const onAnswer = (answer: QuestionAnswer) => run(() => actions.answerQuestion(sessionId, question.id, { selected: answer.selected ?? [], custom: answer.custom ?? '' }))
  const onDismiss = () => run(() => actions.dismissQuestion(sessionId))
  return (
    <div className={inline ? 'bt-q-inline' : 'bt-q-dock'}>
      <QuestionView key={question.id} question={question} onAnswer={onAnswer} onDismiss={onDismiss} onInteract={hold} busy={busy} ownAnswer={question.allowCustom === true} raised={!inline} />
    </div>
  )
}
// Questions asked by a tool call render inline at that call (see ToolCell); the dock
// carries the ones whose call the transcript does not draw, including while history
// loads. A card the user starts editing stays in the dock until it closes.
export function QuestionDock({
  sessionId,
  useRoster,
  useCards,
  useHeldCards,
  actions,
}: {
  sessionId: string
  useRoster: <T>(select: (value: { questions?: Record<string, Question | undefined> }) => T) => T
  useCards?: (<T>(select: (state: Record<string, Record<string, number> | undefined>) => T) => T) | undefined
  useHeldCards?: (<T>(select: (state: Record<string, Record<string, number> | undefined>) => T) => T) | undefined
  actions: QuestionActions
}) {
  const question = useRoster(value => value.questions?.[sessionId])
  const callId = question?.callId ?? ''
  const heldKey = heldCardKey('question', question?.id ?? '')
  const drawn = useCards?.(state => (state[sessionId]?.[callId] ?? 0) > 0) === true
  const held = useHeldCards?.(state => (state[sessionId]?.[heldKey] ?? 0) > 0) === true
  if (question === undefined || (question.callId && drawn && !held)) return null
  return <PendingQuestion key={JSON.stringify([sessionId, question.id])} sessionId={sessionId} question={question} actions={actions} inline={false} />
}
// An answered card in the transcript: the question stays where it was asked, with the
// answer marked.
export function AnsweredCell({ node }: { node: AnsweredNode }) {
  const data = node.data ?? {}
  const questions = Array.isArray(data.questions) ? data.questions : []
  if (questions.length === 0) {
    return data.text ? (
      <div className='bt-urow'>
        <div className='bt-ububble'>{data.text}</div>
      </div>
    ) : null
  }
  const answers = Array.isArray(data.answers) ? data.answers : []
  return (
    <div className='bt-q-inline'>
      {questions.map(question => (
        <SettledQuestion key={question.id} question={question} answer={answers.find(answer => answer.id === question.id) ?? { selected: [] }} />
      ))}
    </div>
  )
}
