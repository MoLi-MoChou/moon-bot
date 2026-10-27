// Moon Bot patch: starter chips over the composer of a fresh chat, so the cards
// (show_view: table, checklist, options) are one tap away. They go once the chat
// has a conversation going, or once the user taps one.
import { createElement as h, useState } from 'react'
import type { Bot } from '../shared/schema.ts'
import { t } from './i18n.ts'

const STARTERS = [
  ['Compare with a table…', '用表格对比一下 iPhone 和安卓旗舰的优缺点'],
  ['Make me a to-do list', '帮我做个这周的待办清单'],
  ['Give me options to pick', '周末去哪儿玩？给我几个选项选'],
] as const

const DONE_KEY = 'moon-bot:starters-done'
const LEGACY_DONE_KEY = 'dsh-bot:starters-done'
const doneSet = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DONE_KEY) ?? localStorage.getItem(LEGACY_DONE_KEY) ?? '[]'
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

// The roster and turn clock the plugin hands every injected view; only what this
// component reads is declared, so the host stays free to pass the wider source.
interface StarterRoster {
  byId?: Record<string, Bot | undefined>
  questions?: Record<string, unknown>
  views?: Record<string, unknown>
}

interface StarterChipsProps {
  sessionId: string
  useRoster: <T>(select: (roster: StarterRoster) => T) => T
  useTurnClock: <T>(select: (clock: Record<string, Record<string, unknown>>) => T) => T
  actions: { send: (id: string, text: string) => unknown }
}

export function StarterChips({ sessionId, useRoster, useTurnClock, actions }: StarterChipsProps) {
  const bot = useRoster(value => value.byId?.[sessionId])
  const turns = useTurnClock(state => Object.keys(state[sessionId] ?? {}).length)
  const pending = useRoster(value => Boolean(value.questions?.[sessionId] || value.views?.[sessionId]))
  const [done, setDone] = useState(() => doneSet().has(sessionId))
  if (!bot || !bot.model || done || pending || turns > 1) return null
  const pick = (text: string): void => {
    const set = doneSet(); set.add(sessionId)
    try { localStorage.setItem(DONE_KEY, JSON.stringify([...set])) } catch {}
    setDone(true)
    void actions.send(sessionId, text)
  }
  return (
    <div className="bt-starters" role="group" aria-label={t('Try a card')}>
      {STARTERS.map(([label, text]) => (
        <button key={label} type="button" className="bt-starter" title={text} onClick={() => pick(text)}>{t(label)}</button>
      ))}
    </div>
  )
}

export const STARTERS_CSS = `
.bt-starters{display:flex;flex-wrap:wrap;gap:8px;padding:0 23px 10px}
.bt-starter{border:1px solid var(--bt-line,rgba(0,0,0,.1));background:var(--bt-card,transparent);color:inherit;font:inherit;font-size:13px;line-height:20px;padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap}
.bt-starter:hover{background:var(--bt-hover,rgba(0,0,0,.04))}
`
