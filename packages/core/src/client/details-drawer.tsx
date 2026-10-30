import { Fragment, type Ref, createElement as h, useEffect, useRef, useState } from 'react';
import { isMainOf } from './sources.ts';
import { HEADER, currentPart, runStatsOf, stripHeader, usageOf } from './text.ts';
import type { RunStatsValues } from './text.ts';
import { PlusIcon, ShareIcon, CloseIcon, ChevronLeftIcon, GearIcon } from './icons.tsx';
import { botState, BotMark, BotAvatar } from './mark.tsx';
import { GlobeIcon, Favicon } from './browser-pane.tsx';
import type { BrowserPagesHook, BrowserTabsHook, ForwardedHook, PanelPage, PanelPages, PanelTabs, PanelView } from './browser-pane.tsx';
import { useEscape } from './overlay-hooks.ts';
import { EmptyState } from 'moon-bot-ui';
import { BotSettingsForm } from './bot-settings.tsx';
import { GroupSettingsForm, ROOM_MODES, roomSubtitle, shownMode } from './group-settings.tsx';
import { ModelMenu, modelOf } from './model-menu.tsx';
import { FolderMenu } from './folder-menu.tsx';
import { MemoryRow } from './memory-panel.tsx';
import { ScheduleSummary } from './schedules.tsx';
import { LEAN } from './lean.ts';
import { useGlide, useMorph } from './motion.tsx';
import { MemberApprovals, MemberState, StopMemberWork, useMemberWork, workState } from './member-status.tsx';
import type { MemberEntry } from './member-status.tsx';
import { PermissionPicker, presetDanger, presetName } from './permission-picker.tsx';
import type { ActivityHook, DetailsDrawerActions, DetailsDrawerProps, DetailsDrawerRoster, DrawerBot, DrawerRoom, OutlineEntry, SessionList, SessionStatusHook, SessionsHook, } from './details-drawer-types.ts';
import { t } from './i18n.ts';
import type { I18nKey } from './i18n.ts';
function transcriptOf(list: SessionList, id: string, name: string, hiddenTurns: readonly number[] | undefined): string {
    const outline = (list.projectionsBySession?.[id]?.values?.turnOutline ?? list.byId[id]?.projectionValues?.turnOutline) as OutlineEntry[] | undefined;
    if (!Array.isArray(outline))
        return '';
    const lines: string[] = [];
    for (const entry of outline) {
        if (hiddenTurns?.includes(entry.turn))
            continue;
        if (entry.prompt && !HEADER.test(entry.prompt))
            lines.push(`**${t('You')}:** ${entry.prompt.trim()}`);
        if (entry.response)
            lines.push(`**${name}:** ${stripHeader(entry.response).trim()}`);
    }
    return lines.join('\n\n');
}
const TAB_LABELS: Record<PanelView, I18nKey> = { details: 'Details', browser: 'Browser' };
const hostOf = (url: string): string => { try {
    return new URL(url).hostname.replace(/^www\./, '');
}
catch {
    return '';
} };
const shortUrl = (url: string | undefined): string => String(url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
const EMPTY_TABS: PanelTabs = { ids: [], active: null };
const EMPTY_PAGE: Partial<PanelPage> = {};
interface PermissionRowProps {
    bot: DrawerBot;
    roster: DetailsDrawerRoster;
    actions: DetailsDrawerActions;
    run: (work: Promise<unknown>) => Promise<boolean>;
}
// The Bot's permission preset, from the presets DeepSeek Harness offers.
function PermissionRow({ bot, roster, actions, run }: PermissionRowProps) {
    const catalog = roster.permissions;
    if (!catalog?.options?.length)
        return null;
    return <div className='bt-drawer-permission'><div className='bt-section-title'>{t('Permissions')}</div>{
    // A Bot without its own preset may run on another one set in the host, so its first pick always applies.
    <PermissionPicker catalog={catalog} saved={bot.permission ?? catalog.defaultPreset} repick={bot.permission === undefined} onPick={permission => run(actions.updateBot(bot.id, { permission }))} />}</div>;
}
interface RunStatsProps {
    bot: DrawerBot;
    part: string;
    running: boolean;
    actions: DetailsDrawerActions;
}
// The current part's turns, speed, cache hits and context, for a window without the host's
// status bar (actions.runStats). It reads them again when a turn starts or ends.
function RunStats({ bot, part, running, actions }: RunStatsProps) {
    const [values, setValues] = useState<RunStatsValues | null>(null);
    useEffect(() => {
        if (!actions.runStats)
            return undefined;
        let current = true;
        actions.runStats(bot.id).then((next) => { if (current)
            setValues(next); }, 
        // The line stays as it was until the next read works.
        () => { });
        return () => { current = false; };
    }, [bot.id, part, running]);
    const shown = runStatsOf(values ?? undefined);
    if (shown.length === 0)
        return null;
    return <div className='bt-run-stats'>{shown.map((entry, index) => <>{index > 0 ? <span className='bt-run-sep' aria-hidden>·</span> : null}<span title={entry.title}>{entry.text}</span></>)}</div>;
}
interface BrowserCardsProps {
    bot: DrawerBot;
    sessionId: string;
    roster: DetailsDrawerRoster;
    actions: DetailsDrawerActions;
    useBrowserTabs: BrowserTabsHook;
    useBrowserPages: BrowserPagesHook;
}
// The Bot's browser inside the details page: its tabs as small window cards on
// Desktop, a pointer there on web.
function BrowserCards({ bot, sessionId, roster, actions, useBrowserTabs, useBrowserPages }: BrowserCardsProps) {
    const state = useBrowserTabs(map => map[bot.id] ?? EMPTY_TABS);
    const pages: PanelPages = useBrowserPages(map => map);
    useEffect(() => { actions.browserEnsure?.(bot.id); }, [bot.id]);
    if (roster.browser !== true || !actions.browserShow) {
        return <div className='bt-muted'>{t('The browser is in the desktop app.')}</div>;
    }
    if (state.ids.length === 0) {
        return <EmptyState art={<BotMark bot={bot} size={44} state='idle' live />} title={t("{name}'s browser", { name: bot.name })} hint={t('Open a page here and {name} can read it with you. Logins and cookies stay with {name}; other Bots never see them.', { name: bot.name })} action={{ label: t('Open browser'), onClick: () => actions.openBrowser(sessionId) }} />;
    }
    return <div className='bt-bcards'>{state.ids.map((tabId, index) => {
        const page = pages[tabId] ?? EMPTY_PAGE;
        const label = page.title || shortUrl(page.url) || t('New tab');
        return <div key={tabId} className='bt-bcard' data-active={state.active === tabId || undefined} style={{ animationDelay: `${index * 30}ms` }}><button type='button' className='bt-bcard-shot' aria-label={t('Open {title}', { title: label })} title={page.url} onClick={() => actions.browserPick(sessionId, tabId)}>{page.excerpt
            ? <span className='bt-bcard-preview'><span className='bt-bcard-ptitle'>{label}</span><span className='bt-bcard-excerpt'>{page.excerpt}</span></span> : <span className='bt-bcard-blank'><GlobeIcon /><span>{label}</span></span>}</button><button type='button' className='bt-bcard-x' aria-label={t('Close tab')} title={t('Close tab')} onClick={() => { void actions.browserCloseTab(bot.id, tabId); }}>×</button><div className='bt-bcard-row'><Favicon src={page.favicon ?? null} className='bt-bcard-fav' /><span className='bt-bcard-title'>{label}</span>{page.url ? <span className='bt-bcard-host'>{hostOf(page.url)}</span> : null}</div></div>;
    })}<button type='button' className='bt-bcard-new' style={{ animationDelay: `${state.ids.length * 30}ms` }} onClick={() => actions.browserNewTab(sessionId)}><PlusIcon />{t('New tab')}</button></div>;
}
// About: a Bot's instructions or a group's notice in the overview, folded to five lines.
function About({ text, title = 'About' }: {
    text: string;
    title?: I18nKey;
}) {
    const [open, setOpen] = useState(false);
    const long = text.split('\n').length > 5 || text.length > 240;
    const body = useRef<HTMLDivElement | null>(null);
    useMorph(body, open);
    return <div><div className='bt-section-title'>{t(title)}</div><div ref={body} className='bt-about' data-open={open || undefined}>{text}</div>{long ? <button type='button' className='bt-more' onClick={() => setOpen(value => !value)}>{open ? t('Show less') : t('Show more')}</button> : null}</div>;
}
// A group's face in its details: its first members side by side, each on a disc that
// cuts into the one before, and how many more there are.
const PILE_MAX = 4;
function MemberPile({ room, roster }: {
    room: DrawerRoom;
    roster: DetailsDrawerRoster;
}) {
    const members = room.members.map(id => roster.byId[id]).filter((bot): bot is DrawerBot => bot !== undefined);
    const shown = members.length > PILE_MAX ? members.slice(0, PILE_MAX - 1) : members;
    const more = members.length - shown.length;
    return <span className='bt-pile' aria-hidden>{shown.map((bot, index) => <span key={bot.id} className='bt-pile-face' style={{ animationDelay: `${index * 40}ms` }}><BotMark bot={bot} size={44} live /></span>)}{more > 0 ? <span key='more' className='bt-pile-face bt-pile-more' style={{ animationDelay: `${shown.length * 40}ms` }}>{`+${more}`}</span> : null}</span>;
}
const markOf = (entry: MemberEntry | undefined): string => (entry?.state === 'ask' ? 'alert' : entry?.state === 'work' ? workState(entry.doing) : 'idle');
// One member: its mark, name and what it is doing on one surface that opens its chat;
// Stop beside it while it works here, and the approvals it waits on below.
function MemberRow({ member, entry, room, roster, actions }: {
    member: DrawerBot;
    entry: MemberEntry | undefined;
    room: DrawerRoom;
    roster: DetailsDrawerRoster;
    actions: DetailsDrawerActions;
}) {
    return <div role='listitem' className='bt-member'><div className='bt-member-row'><button type='button' className='bt-member-open' title={t("Open {name}'s chat", { name: member.name })} onClick={() => actions.openSession(member.id)}><BotMark bot={member} size={32} state={markOf(entry)} /><span className='bt-member-text'><span className='bt-member-line'><span className='bt-member-name'>{member.name}</span>{room.admin === member.id ? <span className='bt-tag'>{t('Admin')}</span> : null}</span>{h(MemberState, { entry, bot: member, room, roster })}</span></button><StopMemberWork entry={entry} bot={member} room={room} actions={actions} /></div><MemberApprovals entry={entry} bot={member} actions={actions} /></div>;
}
interface GroupOverviewProps {
    room: DrawerRoom;
    roster: DetailsDrawerRoster;
    actions: DetailsDrawerActions;
    usage: string;
    useWork: ForwardedHook;
    openSettings: () => void;
}
// A group's overview: what members read, who is in it, who answers, and what it
// remembers. Changes are made in its settings.
function GroupOverview({ room, roster, actions, usage, useWork, openSettings }: GroupOverviewProps) {
    const members = room.members.map(id => roster.byId[id]).filter((bot): bot is DrawerBot => bot !== undefined);
    const { entries } = useMemberWork(room, useWork as never);
    return [
        room.notice
            ? <About key='notice' title='Notice' text={room.notice} />
            : <button key='notice' type='button' className='bt-more' onClick={openSettings}>{t('Add a notice in group settings')}</button>,
        <div key='members'><div className='bt-section-title'>{t('Members · {count}', { count: members.length })}</div><div className='bt-members' role='list'>{members.map(member => <MemberRow key={member.id} member={member} entry={entries.find((item: {
                id: string;
            }) => item.id === member.id)} room={room} roster={roster} actions={actions} />)}</div></div>,
        <div key='mode'><div className='bt-section-title'>{t('Who answers')}</div><div className='bt-kv'><span>{t(ROOM_MODES.find(([id]) => id === shownMode(room as never, roster as never))?.[1] ?? 'Everyone')}</span></div></div>,
        room.permission ? <div key='permission'><div className='bt-section-title'>{t('Permissions')}</div><div className='bt-kv'><span className={presetDanger(room.permission) ? 'bt-perm-danger' : undefined}>{presetName(room.permission, roster.permissions)}</span></div></div> : null,
        roster.memory === false ? null : <MemoryRow key='memory' owner={{ id: room.id, name: room.name, group: true }} actions={actions} />,
        usage ? <div key='usage'><div className='bt-section-title'>{t('Usage')}</div><div className='bt-kv'><span>{room.name}</span><span>{usage}</span></div></div> : null,
    ];
}
export function DetailsDrawer({ sessionId, startRenaming, startTab, hasStrip, roster, actions: givenActions, useSessions, useSessionStatus, useActivity, useWork, useBrowserTabs, useBrowserPages }: DetailsDrawerProps) {
    // The panel forwards the shared action bag through its narrower view; every call the
    // drawer makes is on that same bag.
    const actions = givenActions as unknown as DetailsDrawerActions;
    const sessions = useSessions as unknown as SessionsHook;
    const sessionStatus = useSessionStatus as unknown as SessionStatusHook;
    const activity = useActivity as unknown as ActivityHook;
    const owner = roster.byId[sessionId];
    const bot = owner;
    const part = bot ? currentPart(bot) : sessionId;
    const isMainBot = isMainOf({ mainBotIds: roster.mainBotIds ?? [] }, owner?.id);
    const [tab, setTab] = useState<PanelView>('details');
    const room = roster.roomsById?.[sessionId];
    // The info pane swaps its overview for the Bot or group settings view in place.
    const [view, setView] = useState(startTab === 'settings' && (owner || room) ? 'settings' : 'overview');
    const [editing, setEditing] = useState(Boolean(startRenaming && (roster.byId[sessionId] || room)));
    const [draftName, setDraftName] = useState(roster.byId[sessionId]?.name ?? (room?.named ? room.name : ''));
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const glide = useGlide(tab);
    // The settings view comes in from the right and the overview back from the left; a
    // new tab clears from a blur. The first view arrives with the panel.
    const last = useRef<{
        view: string;
        tab: PanelView;
        move: 'in' | 'out' | 'tab' | undefined;
    }>({ view, tab, move: undefined });
    if (last.current.view !== view)
        last.current = { view, tab, move: view === 'settings' ? 'in' : 'out' };
    else if (last.current.tab !== tab)
        last.current = { view, tab, move: 'tab' };
    const move = last.current.move;
    const side = move === 'tab' ? undefined : move;
    const close = () => actions.closeOverlay();
    useEscape(close);
    useEscape(() => setView('overview'), Boolean((bot || room) && view === 'settings'));
    const running = sessionStatus(map => map.get(part)?.running === true);
    const doing = activity(map => map[bot?.id ?? sessionId]);
    const transcript = sessions(list => transcriptOf(list, part, bot?.name ?? room?.name ?? t('Bot'), roster.exchangeTurns?.[part]));
    const usage = sessions(list => usageOf(list, [part, ...(bot?.parts ?? room?.parts ?? [])]));
    const run = (promise: Promise<unknown>): Promise<boolean> => Promise.resolve(promise)
        .then(() => { setError(''); return true; })
        .catch(failure => { setError((failure as {
        message?: string;
    } | null)?.message ?? String(failure)); return false; });
    const share = () => {
        void navigator.clipboard?.writeText(transcript).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        });
    };
    const errorLine = error ? <div className='bt-error' role='alert' style={{ padding: 0 }}>{error}</div> : null;
    if ((bot || room) && view === 'settings') {
        return [
            <div key='head' className='bt-subhead' data-move={move}><button type='button' className='bt-icon-btn' aria-label={t('Back to details')} onClick={() => setView('overview')}><ChevronLeftIcon /></button><span className='bt-subhead-title'>{bot ? t('Settings') : t('Group settings')}</span>{hasStrip ? null : <button type='button' className='bt-icon-btn' aria-label={t('Close details')} onClick={close}><CloseIcon /></button>}</div>,
            <div key='set-body' className='bt-drawer-body bt-set-body' data-move={move}>{errorLine}{bot ? <BotSettingsForm bot={bot as never} roster={roster as never} actions={actions as never} run={run} /> : <GroupSettingsForm room={room as never} roster={roster as never} actions={actions as never} run={run} onDeleted={close} />}</div>,
        ];
    }
    const top = <div className='bt-drawer-top' data-move={side}>{bot || room ? <button type='button' className='bt-round' aria-label={bot ? t('Edit Bot') : t('Group settings')} title={bot ? t('Edit Bot') : t('Group settings')} data-info-row='settings' onClick={() => setView('settings')}><GearIcon /></button> : null}{bot && roster.browser === true && actions.openBrowser
        ? <button type='button' className='bt-round' aria-label={t('Open browser')} title={t("Open this Bot's browser")} onClick={() => actions.openBrowser(sessionId)}><GlobeIcon /></button> : null}{bot || room ? <button type='button' className='bt-round' aria-label={copied ? t('Copied conversation') : t('Share conversation')} title={copied ? t('Copied') : t('Copy conversation as Markdown')} onClick={share}>{copied ? <span key='copied' className='bt-pop-in'>✓</span> : <ShareIcon />}</button> : null}{hasStrip ? null : <button type='button' className='bt-round' aria-label={t('Close details')} onClick={close}><CloseIcon /></button>}</div>;
    if (!bot && !room) {
        return [<>{top}</>, <div key='body' className='bt-drawer-body'><div className='bt-muted'>{t('This conversation is not part of your Bot team.')}</div></div>];
    }
    const current = bot?.name ?? room?.name ?? '';
    const saveName = async (): Promise<void> => {
        setEditing(false);
        const next = draftName.trim();
        if (next === current || (room && !room.named && next === ''))
            return;
        if (bot && next)
            await run(actions.updateBot(bot.id, { name: next }));
        // An empty group name goes back to naming the group after its members.
        if (room)
            await run(actions.updateRoom(room.id, { name: next }));
    };
    const subtitle = bot ? bot.role : roomSubtitle(room as never, roster as never);
    // Tab sets: a 1:1 Bot has Details and Browser; a group has only Details, so no tab row.
    const tabs: readonly PanelView[] = bot ? ['details', 'browser'] : ['details'];
    return [<>{top}</>, <div key='id' className='bt-drawer-id' data-move={side}>{bot ? <BotAvatar bot={bot} size={64} state={botState(running, doing, roster.questions?.[part] !== undefined)} main={isMainBot} badge={false} gaze pokeable />
            : room ? <MemberPile room={room} roster={roster} /> : null}{editing
            ? <input className='bt-drawer-name-input' autoFocus value={draftName} aria-label={bot ? t('Bot name') : t('Group name')} placeholder={room ? t('Name after members') : undefined} onChange={event => setDraftName(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === 'Enter')
                void saveName(); if (event.key === 'Escape') {
                event.stopPropagation();
                setEditing(false);
            } }}/> : <button type='button' className='bt-drawer-name' aria-label={t('Rename {name}', { name: current })} title={t('Rename')} onClick={() => { setDraftName(room && !room.named ? '' : current); setEditing(true); }}>{current}</button>}{subtitle ? <span className='bt-drawer-role'>{subtitle}</span> : null}</div>, tabs.length > 1 ? <div key='tabs' ref={glide.box as Ref<HTMLDivElement>} className='bt-tabs' role='tablist' data-move={side}><span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden/>{tabs.map(key => <button key={key} type='button' role='tab' className='bt-tab' aria-selected={tab === key} onClick={() => setTab(key)}>{t(TAB_LABELS[key])}</button>)}</div> : null, <div key={`body:${tab}`} className='bt-drawer-body' data-move={move}>{errorLine}{room && tab === 'details' ? h(GroupOverview, { room, roster, actions, usage, useWork, openSettings: () => setView('settings') }) : null}{bot && tab === 'details' ? [
            <RunStats key='stats' bot={bot} part={part} running={running} actions={actions} />,
            <div key='model' className='bt-drawer-model'><div className='bt-section-title'>{t('Model')}</div><ModelMenu bot={bot as never} roster={roster as never} actions={actions as never} run={run} wide />{modelOf(bot as never, roster as never) ? null : <div className='bt-note'>{t('Pick a model and {name} can start.', { name: bot.name })}</div>}</div>,
            <PermissionRow key='permission' bot={bot} roster={roster} actions={actions} run={run} />,
            <div key='folder' className='bt-drawer-model'><div className='bt-section-title'>{t('Working folder')}</div><FolderMenu value={bot.workDir} actions={actions} run={run} wide onPick={workDir => run(actions.updateBot(bot.id, { workDir }))} /></div>,
            bot.instructions
                ? <About key='about' text={bot.instructions} />
                : <button key='about' type='button' className='bt-more' onClick={() => setView('settings')}>{t('Add instructions in Bot settings')}</button>,
            roster.memory === false ? null : <MemoryRow key='memory' owner={{ id: bot.id, name: bot.name }} actions={actions} />,
            usage ? <div key='usage'><div className='bt-section-title'>{t('Usage')}</div><div className='bt-kv'><span>{bot.name}</span><span>{usage}</span></div></div> : null,
            LEAN.schedules ? <ScheduleSummary key='routines' bot={bot} actions={actions} /> : null,
        ] : null}{bot && tab === 'browser' ? <BrowserCards bot={bot} sessionId={sessionId} roster={roster} actions={actions} useBrowserTabs={useBrowserTabs} useBrowserPages={useBrowserPages} /> : null}</div>];
}
