import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { LEAN } from './lean.ts';
import { ACCENT_INKS, INKS } from './inks.ts';
import { isMainOf } from './sources.ts';
import { allThemes, resolveThemeId } from './themes.ts';
import type { ThemeDefinition, ThemeMode } from './themes.ts';
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, ConnectorIcon, InfoIcon, LibraryIcon, PeopleIcon, RelayIcon, PlugIcon, PlusIcon, SlidersIcon, TasksIcon, SETTINGS_ICONS } from './icons.tsx';
import { EmptyState } from './kit/index.ts';
import { AdminStar, BotAvatar, RoomAvatar } from './mark.tsx';
import { useEscape } from './overlay-hooks.ts';
import { BotSettingsForm } from './bot-settings.tsx';
import { Segmented, useGlide } from './motion.tsx';
import { GroupSettingsForm, NewGroupForm } from './group-settings.tsx';
import { CreateBot } from './create-bot.tsx';
import { KeyIcon } from './secret-card.tsx';
import { SecretsPage } from './secrets-page.tsx';
import { RelayPage } from './relay-page.tsx';
import { TasksPage } from './tasks-page.tsx';
import { UsagePage } from './usage-page.tsx';
import { ConnectorsPage } from './connectors.js';
import { CapabilitiesPage } from './capability-settings.tsx';
import { SchedulesPage } from './schedules.tsx';
import { FeedbackIcon, FeedbackPage } from './feedback.tsx';
import { AboutPage } from './about.tsx';
import type { AboutUpdate } from './about.tsx';
import { ProvidersPage } from './providers-page.tsx';
import { FolderMenu } from './folder-menu.tsx';
import { LibraryPage } from './library-page.tsx';
import { t } from './i18n.ts';
import type { RunWork, SettingsActions, SettingsBot, SettingsPrefs, SettingsRoster } from './settings-types.ts';
const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
// Settings dialog: a 198px page list beside the page. Bots and group chats each list
// their members, and one opens on its own settings form. Usage widens the dialog.
// Models is there only in a window without the host's own settings, which carry the providers.
const ALL_SETTINGS_PAGES: [
    string,
    string
][] = [['general', 'General'], ['models', 'Models'], ['bots', 'Bots'], ['groups', 'Group chats'], ['connectors', 'Connectors'], ['remote', 'Remote agents'], ['capabilities', 'Capabilities'], ['schedules', 'Scheduled tasks'], ['tasks', 'Tasks'], ['usage', 'Usage'], ['library', 'Library'], ['secrets', 'Secrets'], ['feedback', 'Feedback'], ['about', 'About Moon Bot']];
const SETTINGS_PAGES = ALL_SETTINGS_PAGES
    .filter(([id]) => (id !== 'groups' || LEAN.groups) && (id !== 'schedules' || LEAN.schedules));
const PAGE_ICONS: Record<string, () => ReactElement> = { ...SETTINGS_ICONS, models: SlidersIcon, connectors: ConnectorIcon, capabilities: PlugIcon, schedules: ClockIcon, library: LibraryIcon, remote: RelayIcon, tasks: TasksIcon, secrets: KeyIcon, feedback: FeedbackIcon, about: InfoIcon };
interface SetSectionProps {
    title?: string | undefined;
    className?: string | undefined;
    children?: ReactNode | undefined;
}
function SetSection({ title, className = '', children }: SetSectionProps) {
    return <section className={`bt-set-section ${className}`.trim()}><h3>{title}</h3><div className='bt-set-card'>{children}</div></section>;
}
interface SetRowProps {
    label?: string | undefined;
    hint?: string | undefined;
    children?: ReactNode | undefined;
}
function SetRow({ label, hint, children }: SetRowProps) {
    return <div className='bt-set-row'><div className='bt-set-copy'><span>{label}</span>{hint ? <span className='bt-set-hint'>{hint}</span> : null}</div>{children ? <div className='bt-set-control'>{children}</div> : null}</div>;
}
interface ThemePickerProps {
    themes: Record<string, ThemeDefinition>;
    current: string;
    onPick: (id: string) => unknown;
}
// Each theme as a small card: its light and dark surfaces side by side, with the
// accent and a user bubble, so the choice reads before it applies.
function ThemePicker({ themes, current, onPick }: ThemePickerProps) {
    const half = (mode: ThemeMode, side: string) => <span className='bt-theme-half' data-side={side} style={{ background: mode.bg }}><span className='bt-theme-side' style={{ background: mode.sidebar }}/><span className='bt-theme-lines'><span style={{ background: mode.bubble }}/><span className='bt-theme-user' style={{ background: mode.user }}/><span className='bt-theme-dot' style={{ background: mode.accent }}/></span></span>;
    return <div className='bt-theme-pick' role='radiogroup' aria-label={t('Theme')}>{Object.entries(themes).map(([id, theme]) => <button key={id} type='button' role='radio' aria-checked={id === current} className='bt-theme-card' onClick={() => onPick(id)}><span className='bt-theme-preview' aria-hidden>{half(theme.light, 'light')}{half(theme.dark, 'dark')}</span><span className='bt-theme-name'>{t(theme.label ?? '')}</span></button>)}</div>;
}
interface GeneralPageProps {
    roster: SettingsRoster;
    actions: SettingsActions;
    run: RunWork;
}
function GeneralPage({ roster, actions, run }: GeneralPageProps) {
    const prefs: SettingsPrefs = roster.prefs ?? {};
    const themes = allThemes();
    const current = resolveThemeId(themes, prefs.theme ?? '');
    const [custom, setCustom] = useState(prefs.accent ?? '#4d6bfe');
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const pickCustom = (value: string): void => {
        setCustom(value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { void run(actions.setPrefs({ accent: value })); }, 350);
    };
    return [
        <SetSection key='look' title={t('Appearance')}>
          <SetRow label={t('Theme')} hint={t('Colors for the whole team, on every device.')}>
            <ThemePicker themes={themes} current={current} onPick={id => run(actions.setPrefs({ theme: id }))} />
          </SetRow>
          <SetRow label={t('Accent')} hint={t('Unread marks, badges, and the brand mark.')}>
            <div className='bt-swatches'><button type='button' className='bt-swatch bt-swatch-default' title={t('Theme accent')} aria-label={t('Theme accent')} aria-pressed={!prefs.accent} onClick={() => { void run(actions.setPrefs({ accent: null })); }}/>{ACCENT_INKS.map(ink => <button key={ink} type='button' className='bt-swatch' title={t(capitalize(ink))} aria-label={t(capitalize(ink))} aria-pressed={prefs.accent === INKS[ink]?.[0]} style={{ background: INKS[ink]?.[0] }} onClick={() => run(actions.setPrefs({ accent: INKS[ink]?.[0] }))}/>)}<label className='bt-swatch bt-swatch-custom' title={t('Custom accent')} data-on={Boolean(prefs.accent) && !ACCENT_INKS.some(ink => INKS[ink]?.[0] === prefs.accent)}><input type='color' value={custom} aria-label={t('Custom accent')} onChange={(event: React.ChangeEvent<HTMLInputElement>) => pickCustom(event.target.value)}/></label></div>
          </SetRow>
        </SetSection>,
        LEAN.classicMode && actions.setSurface ? <SetSection key='mode' title={t('Mode')}>
          <SetRow label={t('Classic Agent mode')}>
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.setSurface?.('agent')}>{t('Switch')}</button>
          </SetRow>
        </SetSection> : null,
        <LocationsSection key='places' actions={actions} run={run} />,
    ];
}
interface LocationsSectionProps {
    actions: SettingsActions;
    run: RunWork;
}
// The desktop app's preload hands its window `dsBotApp`; only there does the data location
// show, since the host keeps the plugin's data where it runs.
function LocationsSection({ actions, run }: LocationsSectionProps) {
    const app = window.dsBotApp;
    const [team, setTeam] = useState<string | null>(null);
    const [data, setData] = useState<DsDataLocation | null>(null);
    // One change at a time: the data move checks the new folder against the team workspace, and
    // a later team workspace must not finish before an earlier one.
    const [moving, setMoving] = useState(false);
    const busy = useRef(false);
    useEffect(() => {
        void Promise.resolve(actions.folders()).then(info => setTeam(info?.team ?? null)).catch(() => { });
        if (app !== undefined)
            void Promise.resolve(app.dataLocation()).then(setData).catch(() => { });
    }, []);
    const pickTeam = (path: string): Promise<boolean> | undefined => {
        if (busy.current)
            return undefined;
        busy.current = true;
        setMoving(true);
        return run(Promise.resolve(actions.setTeamWorkspace(path)).then((answer) => {
            setTeam(answer.team);
            app?.teamWorkspaceChanged(answer.team);
        }).finally(() => {
            busy.current = false;
            setMoving(false);
        }));
    };
    return <SetSection title={t('Locations')} className='bt-set-places'>
      <SetRow label={t('Team workspace')} hint={t('Where Bots without a folder of their own work.')}>{team === null ? null : <FolderMenu value={team} team actions={actions} run={run} onPick={pickTeam} disabled={moving} />}</SetRow>
      {data === null || app === undefined ? null : <SetRow label={t('Data location')} hint={data.path}>{data.fixed ? null : <button type='button' className='bt-soft bt-soft-sm' disabled={moving} onClick={() => { if (!busy.current)
        void run(app.moveData(team ?? undefined)); }}>{t('Change…')}</button>}</SetRow>}
    </SetSection>;
}
interface MainBotsSectionProps {
    roster: SettingsRoster;
    actions: SettingsActions;
    run: RunWork;
}
// The first Main Bot is the sidebar tile. Picking another Bot there hands it the role
// in one step; more Main Bots can sit beside it.
function MainBotsSection({ roster, actions, run }: MainBotsSectionProps) {
    const mains = (roster.mainBotIds ?? []).map(id => roster.byId[id]).filter((bot): bot is SettingsBot => bot !== undefined);
    const [first, ...others] = mains;
    const candidates = roster.bots.filter(bot => !isMainOf(roster, bot.id));
    return <SetSection title={t('Main Bot')}>
      <SetRow label={t('Main Bot')} hint={first ? t('First in the sidebar. Pick another Bot to hand it the role; {name} then stops being a Main Bot.', { name: first.name }) : undefined}>
        <select className='bt-select' aria-label={t('Main Bot')} value={first?.id ?? ''} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => run(actions.setMain(event.target.value, true, first ? { replace: first.id } : {}))}>{first ? null : <option value=''>{t('Choose a Bot…')}</option>}{roster.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select>
      </SetRow>
      {others.map(bot => <SetRow key={bot.id} label={bot.name} hint={t('Also a Main Bot.')}>
      <button type='button' className='bt-soft bt-soft-sm' onClick={() => run(actions.setMain(bot.id, true, { primary: true }))}>{t('Move to first')}</button>
      <button type='button' className='bt-soft bt-soft-sm' onClick={() => run(actions.setMain(bot.id, false))}>{t('Remove Main Bot role')}</button>
    </SetRow>)}
      {candidates.length > 0 ? <SetRow label={t('Add a Main Bot')} hint={t('Main Bots can create and change Bots, and run every group chat.')}>
      <select className='bt-select' aria-label={t('Add a Main Bot')} value='' onChange={(event: React.ChangeEvent<HTMLSelectElement>) => { if (event.target.value)
        void run(actions.setMain(event.target.value, true)); }}><option value=''>{t('Choose a Bot…')}</option>{candidates.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select>
    </SetRow> : null}
    </SetSection>;
}
const MOTIONS: [
    string,
    string
][] = [['quiet', 'Quiet'], ['normal', 'Normal'], ['lively', 'Lively']];
interface MotionSectionProps {
    roster: SettingsRoster;
    actions: SettingsActions;
    run: RunWork;
}
function MotionSection({ roster, actions, run }: MotionSectionProps) {
    const stored = roster.prefs?.motion;
    const motion = stored === 'quiet' || stored === 'lively' ? stored : 'normal';
    return <SetSection title={t('Animation')}>
      <SetRow label={t('Bot animation')}>
        <Segmented label={t('Bot animation')} value={motion} className='bt-motion-seg'>{MOTIONS.map(([id, label]) => <button key={id} type='button' aria-pressed={motion === id} onClick={() => { if (motion !== id)
        void run(actions.setPrefs({ motion: id })); }}>{t(label)}</button>)}</Segmented>
      </SetRow>
    </SetSection>;
}
interface BotsPageProps {
    roster: SettingsRoster;
    actions: SettingsActions;
    run: RunWork;
}
function BotsPage({ roster, actions, run }: BotsPageProps) {
    const [creating, setCreating] = useState(false);
    return [
        <MainBotsSection key='main' roster={roster} actions={actions} run={run} />,
        <MotionSection key='motion' roster={roster} actions={actions} run={run} />,
        creating
            ? <CreateBot key='create' roster={roster} actions={actions} inline canGoBack={false} onBack={() => setCreating(false)} onCreated={bot => actions.openSettings('bots', bot.id)} />
            : <div key='new' className='bt-actions'><button type='button' className='bt-soft bt-soft-sm bt-with-icon' onClick={() => setCreating(true)}><PlusIcon />{t('New Bot')}</button></div>,
        <SetSection key='bots' title={t('Bots · {count}', { count: roster.bots.length })}>{roster.bots.map(bot => <button key={bot.id} type='button' className='bt-set-row' onClick={() => actions.openSettings('bots', bot.id)}><span className='bt-set-bot'><BotAvatar bot={bot} size={28} badge={false} live={false} /><span className='bt-row-title'>{bot.name}</span>{bot.role ? <span className='bt-tag'>{bot.role}</span> : null}{isMainOf(roster, bot.id) ? <span className='bt-tag'>{t('Main Bot')}</span> : null}{bot.hidden && !isMainOf(roster, bot.id) ? <span className='bt-tag'>{t('Hidden')}</span> : null}</span><span className='bt-chevron'><ChevronRightIcon /></span></button>)}</SetSection>,
    ];
}
interface GroupsPageProps {
    roster: SettingsRoster;
    actions: SettingsActions;
    run: RunWork;
}
function GroupsPage({ roster, actions, run }: GroupsPageProps) {
    const [creating, setCreating] = useState(false);
    useEscape(() => setCreating(false), creating);
    return [
        creating
            ? <NewGroupForm key='create' roster={roster as never} actions={actions as never} run={run} onCancel={() => setCreating(false)} onCreated={(room: {
                    id: string;
                }) => actions.openSettings('groups', room.id)} />
            : <div key='new' className='bt-actions'><button type='button' className='bt-soft bt-soft-sm bt-with-icon' disabled={roster.bots.length < 2} title={roster.bots.length < 2 ? t('A group chat needs at least two Bots') : undefined} onClick={() => setCreating(true)}><PlusIcon />{t('Create group chat')}</button></div>,
        <SetSection key='groups' title={t('Group chats · {count}', { count: roster.rooms.length })}>{roster.rooms.length === 0
            ? <EmptyState icon={<PeopleIcon />} title={t('No group chats yet.')} hint={t('A group chat lets several Bots work on one thing with you.')} action={roster.bots.length >= 2 ? { icon: <PlusIcon />, label: t('Create group chat'), onClick: () => setCreating(true) } : { icon: <PlusIcon />, label: t('Create Bot'), onClick: () => actions.openSettings('bots') }} />
            : roster.rooms.map((room) => {
                const admin = room.admin ? roster.byId[room.admin] : undefined;
                return <button key={room.id} type='button' className='bt-set-row' onClick={() => actions.openSettings('groups', room.id)}><span className='bt-set-bot'><RoomAvatar room={room} roster={roster} size={28} /><span className='bt-row-title'>{room.name}</span><span className='bt-tag'>{t('{count} members', { count: room.members.length })}</span>{admin ? <span className='bt-tag bt-tag-admin'><AdminStar />{admin.name}</span> : null}{room.hidden ? <span className='bt-tag'>{t('Hidden')}</span> : null}</span><span className='bt-chevron'><ChevronRightIcon /></span></button>;
            })}</SetSection>,
    ];
}
type PageMove = 'up' | 'in' | 'out';
export interface SettingsDialogProps {
    page?: string | undefined;
    id?: string | null | undefined;
    roster: SettingsRoster;
    actions: SettingsActions;
    /** The update store, as the shell keeps it: one selected slice of the plugin update state. */
    useUpdate: <T>(select: (value: AboutUpdate) => T) => T;
    leaving?: boolean | undefined;
}
// While `leaving`, the dialog plays its exit and takes no input.
export function SettingsDialog({ page, id, roster, actions, useUpdate, leaving = false }: SettingsDialogProps) {
    const [error, setError] = useState('');
    const close = useCallback(() => actions.closeSettings(), []);
    useEscape(close);
    const run: RunWork = (promise) => Promise.resolve(promise)
        .then(() => { setError(''); return true; })
        .catch((failure: unknown) => { setError(failureMessage(failure)); return false; });
    // A Bot or group deleted while its form is open leaves its page on the list.
    const bot = page === 'bots' && id ? roster.byId[id] : undefined;
    const room = page === 'groups' && id ? roster.roomsById[id] : undefined;
    const pages = SETTINGS_PAGES.filter(([key]) => key !== 'models' || actions.providers !== undefined);
    const shown = page !== undefined && pages.some(([key]) => key === page) ? page : 'general';
    const usageFocus = shown === 'usage' && id ? id : null;
    const pageTitle = pages.find(([key]) => key === shown)?.[1];
    const label = pageTitle === undefined ? '' : t(pageTitle);
    const back = bot ? t('Back to Bots') : room ? t('Back to group chats') : usageFocus ? t('All usage') : null;
    useEscape(() => actions.openSettings(shown), Boolean(bot || room || usageFocus));
    const nav = useGlide(shown, { axis: 'y' });
    // A page enters from the right when it is one level in, from the left when it comes
    // back out, and from below beside it. Usage keeps its own entrance and its data
    // across its own levels, so they share one page.
    const pageKey = `${shown}:${bot?.id ?? room?.id ?? ''}`;
    const depth = bot || room ? 1 : 0;
    const last = useRef<{
        key: string;
        depth: number;
        move: PageMove;
    }>({ key: pageKey, depth, move: 'up' });
    if (last.current.key !== pageKey) {
        last.current = { key: pageKey, depth, move: depth > last.current.depth ? 'in' : depth < last.current.depth ? 'out' : 'up' };
    }
    // Usage stays mounted from its first visit until Settings closes: coming back to it
    // shows the same page at once instead of loading it again. Meanwhile it keeps its
    // rendered state off screen (content-visibility).
    const [usageOpened, setUsageOpened] = useState(shown === 'usage');
    if (shown === 'usage' && !usageOpened)
        setUsageOpened(true);
    const errorLine = error ? <div className='bt-error' role='alert' style={{ padding: 0 }}>{error}</div> : null;
    return <div className='bt-settings-layer' data-leaving={leaving || undefined}><div className='bt-scrim' onMouseDown={close}/><div className='bt-settings' role='dialog' aria-modal aria-label={t('Moon Bot settings')}><nav ref={nav.box} className='bt-settings-nav' aria-label={t('Settings pages')}><span ref={nav.thumb} className='bt-thumb' aria-hidden/>{pages.map(([key, text]) => <button key={key} type='button' className='bt-settings-item' aria-current={shown === key ? 'page' : undefined} onClick={() => actions.openSettings(key)}>{h(PAGE_ICONS[key] ?? InfoIcon)}{t(text)}</button>)}{actions.openShellSettingsPanel ? <button type='button' className='bt-settings-item bt-settings-shell' title={t('Models, providers, and the rest of Moon Bot')} onClick={() => { close(); actions.openShellSettingsPanel?.(); }}><SlidersIcon />{t('Advanced settings')}</button> : null}</nav><div className='bt-settings-main'><div className='bt-settings-head'>{back ? <button type='button' className='bt-icon-btn' aria-label={back} title={back} onClick={() => actions.openSettings(shown)}><ChevronLeftIcon /></button> : null}<h2 key={bot?.id ?? room?.id ?? shown}>{bot?.name ?? room?.name ?? label}</h2></div>{shown === 'usage' ? null : <div key={pageKey} className='bt-settings-scroll bt-settings-page' data-move={last.current.move}>{errorLine}{shown === 'tasks' ? <TasksPage taskActions={actions as never} /> : null}{shown === 'general' ? h(GeneralPage, { roster, actions, run }) : null}{shown === 'models' ? h(ProvidersPage, { actions: actions as never, run, Section: SetSection }) : null}{bot ? <div className='bt-settings-form'><BotSettingsForm key={bot.id} bot={bot as never} roster={roster as never} actions={actions as never} run={run} /></div> : null}{shown === 'bots' && !bot ? h(BotsPage, { roster: roster as never, actions: actions as never, run }) : null}{room ? <div className='bt-settings-form'><GroupSettingsForm key={room.id} room={room as never} roster={roster as never} actions={actions as never} run={run} /></div> : null}{shown === 'groups' && !room ? h(GroupsPage, { roster, actions, run }) : null}{shown === 'connectors' ? <ConnectorsPage roster={roster as never} actions={actions as never} market={actions as never} /> : null}{shown === 'remote' ? <RelayPage relay={actions as never} /> : null}{shown === 'capabilities' ? <CapabilitiesPage roster={roster as never} actions={actions as never} run={run} /> : null}{shown === 'schedules' ? h(SchedulesPage, { roster, actions, start: id ?? undefined }) : null}{shown === 'secrets' ? h(SecretsPage, { roster: roster as never, actions: actions as never, run, Section: SetSection }) : null}{shown === 'feedback' ? h(FeedbackPage, { actions, run, Section: SetSection, Row: SetRow }) : null}{shown === 'about' ? h(AboutPage, { useUpdate, actions, run, Section: SetSection, Row: SetRow }) : null}{shown === 'library' ? <LibraryPage roster={roster} actions={actions} /> : null}</div>}{usageOpened ? <div key='usage' className='bt-settings-scroll bt-settings-usage' data-off={shown === 'usage' ? undefined : ''} aria-hidden={shown === 'usage' ? undefined : true}>{shown === 'usage' ? errorLine : null}<UsagePage roster={roster} actions={actions} focusId={usageFocus} /></div> : null}</div><button type='button' className='bt-settings-close' aria-label={t('Close settings')} onClick={close}><CloseIcon /></button></div></div>;
}
const failureMessage = (failure: unknown): string => (failure as {
    message?: string;
} | null)?.message ?? String(failure);
