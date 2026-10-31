import { Fragment, type Ref, createElement as h, useRef, useState } from 'react'
import { isMainOf } from './sources.ts'
import { HEADER, currentPart, stripHeader, usageOf } from './text.ts'
import { ShareIcon, CloseIcon, ChevronLeftIcon, GearIcon } from './icons.tsx'
import { botState, BotAvatar } from './mark.tsx'
import { GlobeIcon } from './browser-pane.tsx'
import type { PanelView } from './browser-pane.tsx'
import { useEscape } from './overlay-hooks.ts'
import { BotSettingsForm } from './bot-settings.tsx'
import { GroupSettingsForm, roomSubtitle } from './group-settings.tsx'
import { ModelMenu, modelOf } from './model-menu.tsx'
import { FolderMenu } from './folder-menu.tsx'
import { MemoryRow } from './memory-panel.tsx'
import { ScheduleSummary } from './schedules.tsx'
import { LEAN } from './lean.ts'
import { useGlide } from './motion.tsx'
import type {
  ActivityHook,
  DetailsDrawerActions,
  DetailsDrawerProps,
  OutlineEntry,
  SessionList,
  SessionStatusHook,
  SessionsHook,
} from './details-drawer-types.ts'
import { t } from './i18n.ts'
import type { I18nKey } from './i18n.ts'
import { BrowserCards } from './details-drawer-browser.tsx'
import { About, GroupOverview, MemberPile, PermissionRow, RunStats } from './details-drawer-overview.tsx'

function transcriptOf(list: SessionList, id: string, name: string, hiddenTurns: readonly number[] | undefined): string {
  const outline = (list.projectionsBySession?.[id]?.values?.turnOutline ??
    list.byId[id]?.projectionValues?.turnOutline) as OutlineEntry[] | undefined
  if (!Array.isArray(outline)) return ''
  const lines: string[] = []
  for (const entry of outline) {
    if (hiddenTurns?.includes(entry.turn)) continue
    if (entry.prompt && !HEADER.test(entry.prompt)) lines.push(`**${t('You')}:** ${entry.prompt.trim()}`)
    if (entry.response) lines.push(`**${name}:** ${stripHeader(entry.response).trim()}`)
  }
  return lines.join('\n\n')
}

const TAB_LABELS: Record<PanelView, I18nKey> = { details: 'Details', browser: 'Browser' }

export function DetailsDrawer({
  sessionId,
  startRenaming,
  startTab,
  hasStrip,
  roster,
  actions: givenActions,
  useSessions,
  useSessionStatus,
  useActivity,
  useWork,
  useBrowserTabs,
  useBrowserPages,
}: DetailsDrawerProps) {
  // The panel forwards the shared action bag through its narrower view; every call the
  // drawer makes is on that same bag.
  const actions = givenActions as unknown as DetailsDrawerActions
  const sessions = useSessions as unknown as SessionsHook
  const sessionStatus = useSessionStatus as unknown as SessionStatusHook
  const activity = useActivity as unknown as ActivityHook
  const owner = roster.byId[sessionId]
  const bot = owner
  const part = bot ? currentPart(bot) : sessionId
  const isMainBot = isMainOf({ mainBotIds: roster.mainBotIds ?? [] }, owner?.id)
  const [tab, setTab] = useState<PanelView>('details')
  const room = roster.roomsById?.[sessionId]
  // The info pane swaps its overview for the Bot or group settings view in place.
  const [view, setView] = useState(startTab === 'settings' && (owner || room) ? 'settings' : 'overview')
  const [editing, setEditing] = useState(Boolean(startRenaming && (roster.byId[sessionId] || room)))
  const [draftName, setDraftName] = useState(roster.byId[sessionId]?.name ?? (room?.named ? room.name : ''))
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const glide = useGlide(tab)
  // The settings view comes in from the right and the overview back from the left; a
  // new tab clears from a blur. The first view arrives with the panel.
  const last = useRef<{ view: string; tab: PanelView; move: 'in' | 'out' | 'tab' | undefined }>({
    view,
    tab,
    move: undefined,
  })
  if (last.current.view !== view) last.current = { view, tab, move: view === 'settings' ? 'in' : 'out' }
  else if (last.current.tab !== tab) last.current = { view, tab, move: 'tab' }
  const move = last.current.move
  const side = move === 'tab' ? undefined : move
  const close = () => actions.closeOverlay()
  useEscape(close)
  useEscape(() => setView('overview'), Boolean((bot || room) && view === 'settings'))
  const running = sessionStatus(map => map.get(part)?.running === true)
  const doing = activity(map => map[bot?.id ?? sessionId])
  const transcript = sessions(list =>
    transcriptOf(list, part, bot?.name ?? room?.name ?? t('Bot'), roster.exchangeTurns?.[part]),
  )
  const usage = sessions(list => usageOf(list, [part, ...(bot?.parts ?? room?.parts ?? [])]))
  const run = (promise: Promise<unknown>): Promise<boolean> =>
    Promise.resolve(promise)
      .then(() => {
        setError('')
        return true
      })
      .catch(failure => {
        setError((failure as { message?: string } | null)?.message ?? String(failure))
        return false
      })
  const share = () => {
    void navigator.clipboard?.writeText(transcript).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  const errorLine = error ? (
    <div className='bt-panel-error' role='alert'>
      {error}
    </div>
  ) : null
  if ((bot || room) && view === 'settings') {
    return [
      <div key='head' className='bt-subhead' data-move={move}>
        <button
          type='button'
          className='bt-icon-btn'
          aria-label={t('Back to details')}
          onClick={() => setView('overview')}>
          <ChevronLeftIcon />
        </button>
        <span className='bt-subhead-title'>{bot ? t('Settings') : t('Group settings')}</span>
        {hasStrip ? null : (
          <button type='button' className='bt-icon-btn' aria-label={t('Close details')} onClick={close}>
            <CloseIcon />
          </button>
        )}
      </div>,
      <div key='set-body' className='bt-drawer-body bt-set-body' data-move={move}>
        {errorLine}
        {bot ? (
          <BotSettingsForm bot={bot as never} roster={roster as never} actions={actions as never} run={run} />
        ) : (
          <GroupSettingsForm
            room={room as never}
            roster={roster as never}
            actions={actions as never}
            run={run}
            onDeleted={close}
          />
        )}
      </div>,
    ]
  }
  const top = (
    <div className='bt-drawer-top' data-move={side}>
      {bot || room ? (
        <button
          type='button'
          className='bt-round'
          aria-label={bot ? t('Edit Bot') : t('Group settings')}
          title={bot ? t('Edit Bot') : t('Group settings')}
          data-info-row='settings'
          onClick={() => setView('settings')}>
          <GearIcon />
        </button>
      ) : null}
      {bot && roster.browser === true && actions.openBrowser ? (
        <button
          type='button'
          className='bt-round'
          aria-label={t('Open browser')}
          title={t("Open this Bot's browser")}
          onClick={() => actions.openBrowser(sessionId)}>
          <GlobeIcon />
        </button>
      ) : null}
      {bot || room ? (
        <button
          type='button'
          className='bt-round'
          aria-label={copied ? t('Copied conversation') : t('Share conversation')}
          title={copied ? t('Copied') : t('Copy conversation as Markdown')}
          onClick={share}>
          {copied ? (
            <span key='copied' className='bt-pop-in'>
              ✓
            </span>
          ) : (
            <ShareIcon />
          )}
        </button>
      ) : null}
      {hasStrip ? null : (
        <button type='button' className='bt-round' aria-label={t('Close details')} onClick={close}>
          <CloseIcon />
        </button>
      )}
    </div>
  )
  if (!bot && !room) {
    return [
      <>{top}</>,
      <div key='body' className='bt-drawer-body'>
        <div className='bt-muted'>{t('This conversation is not part of your Bot team.')}</div>
      </div>,
    ]
  }
  const current = bot?.name ?? room?.name ?? ''
  const saveName = async (): Promise<void> => {
    setEditing(false)
    const next = draftName.trim()
    if (next === current || (room && !room.named && next === '')) return
    if (bot && next) await run(actions.updateBot(bot.id, { name: next }))
    // An empty group name goes back to naming the group after its members.
    if (room) await run(actions.updateRoom(room.id, { name: next }))
  }
  const subtitle = bot ? bot.role : roomSubtitle(room as never, roster as never)
  // Tab sets: a 1:1 Bot has Details and Browser; a group has only Details, so no tab row.
  const tabs: readonly PanelView[] = bot ? ['details', 'browser'] : ['details']
  return [
    <>{top}</>,
    <div key='id' className='bt-drawer-id' data-move={side}>
      {bot ? (
        <BotAvatar
          bot={bot}
          size={64}
          state={botState(running, doing, roster.questions?.[part] !== undefined)}
          main={isMainBot}
          badge={false}
          gaze
          pokeable
        />
      ) : room ? (
        <MemberPile room={room} roster={roster} />
      ) : null}
      {editing ? (
        <input
          className='bt-drawer-name-input'
          autoFocus
          value={draftName}
          aria-label={bot ? t('Bot name') : t('Group name')}
          placeholder={room ? t('Name after members') : undefined}
          onChange={event => setDraftName(event.target.value)}
          onBlur={saveName}
          onKeyDown={event => {
            if (event.key === 'Enter') void saveName()
            if (event.key === 'Escape') {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type='button'
          className='bt-drawer-name'
          aria-label={t('Rename {name}', { name: current })}
          title={t('Rename')}
          onClick={() => {
            setDraftName(room && !room.named ? '' : current)
            setEditing(true)
          }}>
          {current}
        </button>
      )}
      {subtitle ? <span className='bt-drawer-role'>{subtitle}</span> : null}
    </div>,
    tabs.length > 1 ? (
      <div key='tabs' ref={glide.box as Ref<HTMLDivElement>} className='bt-tabs' role='tablist' data-move={side}>
        <span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden />
        {tabs.map(key => (
          <button
            key={key}
            type='button'
            role='tab'
            className='bt-tab'
            aria-selected={tab === key}
            onClick={() => setTab(key)}>
            {t(TAB_LABELS[key])}
          </button>
        ))}
      </div>
    ) : null,
    <div key={`body:${tab}`} className='bt-drawer-body' data-move={move}>
      {errorLine}
      {room && tab === 'details'
        ? h(GroupOverview, { room, roster, actions, usage, useWork, openSettings: () => setView('settings') })
        : null}
      {bot && tab === 'details'
        ? [
            <RunStats key='stats' bot={bot} part={part} running={running} actions={actions} />,
            <div key='model' className='bt-drawer-model'>
              <div className='bt-section-title'>{t('Model')}</div>
              <ModelMenu bot={bot as never} roster={roster as never} actions={actions as never} run={run} wide />
              {modelOf(bot as never, roster as never) ? null : (
                <div className='bt-note'>{t('Pick a model and {name} can start.', { name: bot.name })}</div>
              )}
            </div>,
            <PermissionRow key='permission' bot={bot} roster={roster} actions={actions} run={run} />,
            <div key='folder' className='bt-drawer-model'>
              <div className='bt-section-title'>{t('Working folder')}</div>
              <FolderMenu
                value={bot.workDir}
                actions={actions}
                run={run}
                wide
                onPick={workDir => run(actions.updateBot(bot.id, { workDir }))}
              />
            </div>,
            bot.instructions ? (
              <About key='about' text={bot.instructions} />
            ) : (
              <button key='about' type='button' className='bt-more' onClick={() => setView('settings')}>
                {t('Add instructions in Bot settings')}
              </button>
            ),
            roster.memory === false ? null : (
              <MemoryRow key='memory' owner={{ id: bot.id, name: bot.name }} actions={actions} />
            ),
            usage ? (
              <div key='usage'>
                <div className='bt-section-title'>{t('Usage')}</div>
                <div className='bt-kv'>
                  <span>{bot.name}</span>
                  <span>{usage}</span>
                </div>
              </div>
            ) : null,
            LEAN.schedules ? <ScheduleSummary key='routines' bot={bot} actions={actions} /> : null,
          ]
        : null}
      {bot && tab === 'browser' ? (
        <BrowserCards
          bot={bot}
          sessionId={sessionId}
          roster={roster}
          actions={actions}
          useBrowserTabs={useBrowserTabs}
          useBrowserPages={useBrowserPages}
        />
      ) : null}
    </div>,
  ]
}
