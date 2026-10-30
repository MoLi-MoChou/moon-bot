// The autocomplete popup above the composer for "@" mentions and "/" commands.
import { createElement as h, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { BotAvatar } from '../../../../packages/core/src/client/mark.tsx'
import type { MarkBot } from '../../../../packages/core/src/client/mark.tsx'
import type { ClientBot } from '../../../../packages/core/src/client/client-types.ts'
import {
  CalendarIcon,
  GearIcon,
  MemoryIcon,
  MicIcon,
  PeopleIcon,
  PlugIcon,
  PlusIcon,
  SlidersIcon,
} from '../../../../packages/core/src/client/icons.tsx'
import { t } from '../../../../packages/core/src/client/i18n.ts'
import type { Team } from './team.ts'

export interface TriggerItem {
  readonly id: string
  readonly title: string
  readonly badge?: string | undefined
  readonly subtitle?: string | undefined
  readonly icon?: ReactNode | undefined
  readonly textToInsert?: string | undefined
  readonly onSelect?: (() => void) | undefined
}

export interface TriggerContext {
  readonly kind: 'mention' | 'command'
  readonly query: string
  readonly range: { readonly start: number; readonly end: number }
}

/** Detects if the caret is currently inside an '@' mention or '/' slash command. */
export function detectTrigger(text: string, caret: number): TriggerContext | null {
  const before = text.slice(0, caret)

  // Look for slash command: must be at start of input or preceded by whitespace/newline
  const lastSlash = before.lastIndexOf('/')
  if (lastSlash >= 0 && (lastSlash === 0 || /\s/.test(before[lastSlash - 1] ?? ''))) {
    const query = before.slice(lastSlash + 1)
    if (!/\s/.test(query)) {
      return { kind: 'command', query, range: { start: lastSlash, end: caret } }
    }
  }

  // Look for @ mention: must be at start of input or preceded by whitespace/newline
  const lastAt = before.lastIndexOf('@')
  if (lastAt >= 0 && (lastAt === 0 || /\s/.test(before[lastAt - 1] ?? ''))) {
    const query = before.slice(lastAt + 1)
    if (!/\s/.test(query)) {
      return { kind: 'mention', query, range: { start: lastAt, end: caret } }
    }
  }

  return null
}

interface ComposerMenuProps {
  readonly trigger: TriggerContext
  readonly sessionId: string
  readonly useRoster: Team['hooks']['useRoster']
  readonly actions: Team['actions']
  readonly onPick: (item: TriggerItem) => void
  readonly onDismiss: () => void
  readonly activeIndex: number
  readonly onActiveIndexChange: (index: number) => void
  readonly onItemsChange?: (items: readonly TriggerItem[]) => void
}

export function ComposerMenu({
  trigger,
  sessionId,
  useRoster,
  actions,
  onPick,
  activeIndex,
  onActiveIndexChange,
  onItemsChange,
}: ComposerMenuProps): ReactElement | null {
  const roster = useRoster(value => value)
  const menuRef = useRef<HTMLDivElement>(null)

  // Build the list of items based on kind and query
  const query = trigger.query.toLowerCase().trim()
  let items: TriggerItem[] = []

  if (trigger.kind === 'mention') {
    const isRoom = Boolean(roster.roomsById?.[sessionId])
    const bots = (roster.bots ?? []) as readonly ClientBot[]

    // In a room or multi-bot team, offer @Everyone if it matches
    const everyoneWord = String(t('Everyone'))
    if (isRoom && (query === '' || everyoneWord.toLowerCase().includes(query) || '所有人'.includes(query))) {
      items.push({
        id: 'mention:everyone',
        title: `@${everyoneWord}`,
        badge: t('Group'),
        subtitle: t('Call all Bots in this group chat'),
        icon: <PeopleIcon />,
        textToInsert: `@${everyoneWord} `,
      })
    }

    // Filter matching bots
    const matchedBots = bots.filter(b => {
      const name = (b.name ?? '').toLowerCase()
      const role = (b.role ?? '').toLowerCase()
      return query === '' || name.includes(query) || role.includes(query)
    })

    for (const bot of matchedBots) {
      items.push({
        id: `mention:${bot.id ?? bot.name}`,
        title: `@${bot.name}`,
        badge: bot.role || undefined,
        subtitle: bot.role ? t('Bot · {role}', { role: bot.role }) : t('Bot'),
        icon: <BotAvatar bot={bot as unknown as MarkBot} size={20} />,
        textToInsert: `@${bot.name} `,
      })
    }
  } else if (trigger.kind === 'command') {
    const commands: TriggerItem[] = [
      {
        id: 'cmd:new',
        title: '/clear',
        badge: t('New chat'),
        subtitle: t('Start a fresh conversation part, keeping past messages saved'),
        icon: <PlusIcon />,
        onSelect: () => {
          actions.openNewChat('own')
        },
      },
      {
        id: 'cmd:settings',
        title: '/settings',
        badge: t('Settings'),
        subtitle: t('Adjust preferences, theme appearance, and language'),
        icon: <GearIcon />,
        onSelect: () => {
          actions.openSettings('general')
        },
      },
      {
        id: 'cmd:models',
        title: '/models',
        badge: t('Models'),
        subtitle: t('Configure AI models, API keys, and providers'),
        icon: <SlidersIcon />,
        onSelect: () => {
          actions.openSettings('models')
        },
      },
      {
        id: 'cmd:connectors',
        title: '/connectors',
        badge: t('Market'),
        subtitle: t('Manage ACP agent connectors, MCP tools, and plugins'),
        icon: <PlugIcon />,
        onSelect: () => {
          actions.openConnectors()
        },
      },
      {
        id: 'cmd:tasks',
        title: '/tasks',
        badge: t('Schedules'),
        subtitle: t('View and manage periodic tasks, reminders, and schedules'),
        icon: <CalendarIcon />,
        onSelect: () => {
          actions.openSettings('schedules')
        },
      },
      {
        id: 'cmd:memory',
        title: '/memory',
        badge: t('Memory'),
        subtitle: t('Search and review what this Bot has remembered'),
        icon: <MemoryIcon />,
        onSelect: () => {
          actions.openMemory(sessionId)
        },
      },
      {
        id: 'cmd:voice',
        title: '/voice',
        badge: t('Voice'),
        subtitle: t('Start voice chat or audio dictation'),
        icon: <MicIcon size={16} />,
        onSelect: () => {
          actions.openVoice(sessionId)
        },
      },
    ]

    items = commands.filter(cmd => {
      if (query === '') return true
      return cmd.title.toLowerCase().includes(query) || (cmd.badge ?? '').toLowerCase().includes(query)
    })
  }

  // Notify parent of items length so keyboard navigation stays in sync
  useEffect(() => {
    onItemsChange?.(items)
  }, [items.length, onItemsChange])

  // Scroll active item into view
  useEffect(() => {
    const menuNode = menuRef.current
    if (menuNode === null) return
    const activeEl = menuNode.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | null
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  if (items.length === 0) return null

  return (
    <div
      ref={menuRef}
      className='mb-trigger-menu'
      role='listbox'
      aria-label={trigger.kind === 'mention' ? t('Mentions') : t('Commands')}>
      <div className='mb-trigger-head'>{trigger.kind === 'mention' ? t('Mention Bot') : t('Quick Commands')}</div>
      {items.map((item, index) => {
        const isActive = index === activeIndex
        return (
          <button
            key={item.id}
            type='button'
            className='mb-trigger-item'
            data-active={isActive}
            data-index={index}
            role='option'
            aria-selected={isActive}
            onMouseEnter={() => onActiveIndexChange(index)}
            onMouseDown={(e: React.MouseEvent) => {
              e.preventDefault()
              onPick(item)
            }}>
            <span className='mb-trigger-icon'>{item.icon}</span>
            <span className='mb-trigger-info'>
              <span className='mb-trigger-title'>
                {item.title}
                {item.badge ? <span className='mb-trigger-badge'>{item.badge}</span> : null}
              </span>
              {item.subtitle ? <span className='mb-trigger-sub'>{item.subtitle}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
