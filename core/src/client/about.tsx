// Settings → About: the version, updates for Moon Bot and the runtime, and the links to
// the repository. The sidebar's cloud button shows the same update state.
import { createElement as h, useEffect, useState } from 'react';
import { GitHubMark } from './connectors.js';
import { whenText } from './feedback.tsx';
import { dateLocale, hostText, t, productName } from './i18n.ts';
import { StarLineIcon } from './icons.tsx';
import { SPRING_POP } from './motion.tsx';
import { MoonBotMark } from './icons.tsx';
// The desktop app's own updater and its engine downloader, as the app exposes them.
interface AppUpdateState {
    phase?: string;
    version?: string;
    percent?: number;
    checkedAt?: number;
    error?: string;
    reason?: string;
    current?: string;
}
interface AppUpdateBridge {
    state: () => Promise<AppUpdateState | null>;
    onChange: (listener: (state: AppUpdateState | null) => void) => (() => void) | undefined;
    check: () => Promise<AppUpdateState | null>;
    install: () => Promise<unknown>;
}
interface AppEngineState {
    phase?: string;
    percent?: number;
    error?: string;
}
interface AppEngineBridge {
    state: () => Promise<AppEngineState | null>;
    onChange: (listener: (state: AppEngineState | null) => void) => (() => void) | undefined;
    download: () => Promise<AppEngineState | null>;
}
// The plugin's own update state, and DSH's beside it.
export interface AboutUpdate {
    phase?: string;
    available?: boolean;
    latest?: string;
    installed?: string;
    source?: string;
    enabled?: boolean;
    checkedAt?: number;
    error?: string;
    notesUrl?: string;
    current?: string;
    repoUrl?: string;
    app?: {
        phase?: string;
        version?: string;
    };
}
export interface AboutActions {
    checkUpdate: () => Promise<unknown>;
    installUpdate: () => Promise<unknown>;
    openAppUpdates: (version?: string) => void;
    openSettings: (page: string) => void;
    repoStars: () => Promise<number>;
}
export type RunWork = (work: Promise<unknown>) => Promise<boolean | undefined>;
type SectionLike = React.ComponentType<Record<string, unknown>>;
type RowLike = React.ComponentType<Record<string, unknown>>;
// The length of the mark's `done` hop (bt-done in styles.js).
const CHEER_MS = 1800;
const starCount = (count: number): string => new Intl.NumberFormat(dateLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(count);
function botHint(update: AboutUpdate): string | null {
    if (update.phase === 'installing')
        return t('Updating Moon Bot…');
    if (update.phase === 'installed')
        return t('Restart to start using Moon Bot {version}.', { version: update.installed ?? update.latest });
    if (update.phase === 'failed')
        return t('The update did not finish: {reason}', { reason: hostText(update.error ?? '') });
    if (update.available)
        return t('Moon Bot {version} is available', { version: update.latest });
    if (update.source === 'app')
        return t('Updates come with the Moon Bot desktop app.');
    if (update.source === 'web')
        return t('The web version updates when its server is redeployed.');
    if (update.enabled === false)
        return t('Update checks are off.');
    if (update.source === 'path')
        return t('Installed from a local folder; update it there.');
    if (!update.checkedAt)
        return null;
    if (!update.latest && update.source !== 'registry')
        return t('Updates are not offered for this install.');
    const checked = t('Checked {time}', { time: whenText(update.checkedAt) });
    return `${update.latest ? t('Up to date') : t('Could not check for updates.')} · ${checked}`;
}
// Moon Bot patch: the desktop app's own updater (electron-updater in the app's main
// process): checks at launch and every few hours, downloads only the changed blocks,
// then installs silently on restart. This row lets the user check, watch, and restart.
const RELEASES_PAGE = 'https://github.com/MoLi-MoChou/moon-bot/releases';
const appBridge = (): AppUpdateBridge | null => (typeof window === 'undefined' ? null : (window.dsBotApp?.updates as AppUpdateBridge | undefined) ?? null);
function useAppUpdate(): [
    AppUpdateBridge | null,
    AppUpdateState | null,
    React.Dispatch<React.SetStateAction<AppUpdateState | null>>
] {
    const bridge = appBridge();
    const [state, setState] = useState<AppUpdateState | null>(null);
    useEffect(() => {
        if (!bridge)
            return undefined;
        let live = true;
        bridge.state().then((value) => { if (live)
            setState(value); }, () => { });
        const off = bridge.onChange((value) => { if (live)
            setState(value); });
        return () => { live = false; off?.(); };
    }, [bridge]);
    return [bridge, state, setState];
}
function appHint(state: AppUpdateState | null): string | null {
    if (!state)
        return null;
    switch (state.phase) {
        case 'checking': return t('Checking for updates…');
        case 'downloading': return t('Downloading {version} · {percent}%', { version: state.version ?? '', percent: Math.floor(state.percent ?? 0) });
        case 'downloaded': return t('{version} is ready. Restart to update; nothing to reinstall.', { version: state.version });
        case 'latest': return t('Up to date') + (state.checkedAt ? ` · ${t('Checked {time}', { time: whenText(state.checkedAt) })}` : '');
        case 'error': return t('Could not check for updates.') + (state.error ? ` ${state.error}` : '');
        case 'unsupported': return state.reason === 'portable' ? t('The portable exe does not update itself: download the new one from the releases page and replace this file. Your data stays.') : state.reason === 'dev' ? t('Updates work in the installed app.') : state.reason === 'package' ? t('This package updates through its package manager; the AppImage and Windows installer update themselves.') : t('Update checks are off.');
        default: return state.current ? t('Version {version}', { version: state.current }) : null;
    }
}
function AppUpdateRow({ Row, run }: {
    Row: RowLike;
    run: RunWork;
}) {
    const [bridge, state, setState] = useAppUpdate();
    if (!bridge)
        return null;
    const phase = state?.phase ?? 'idle';
    const percent = state?.percent ?? 0;
    const control = phase === 'downloaded'
        ? <button type='button' className='bt-fb-primary' onClick={() => run(bridge.install())}>{t('Restart to update')}</button> : phase === 'downloading'
        ? <span className='bt-app-progress' role='progressbar' aria-valuenow={Math.floor(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}/></span> : phase === 'unsupported' ? (state?.reason === 'portable' ? <a {...linkProps(RELEASES_PAGE)}>{t('Open')}</a> : null)
        : <button type='button' className='bt-soft bt-soft-sm' disabled={phase === 'checking'} onClick={() => run(bridge.check().then(setState))}>{phase === 'checking' ? t('Checking…') : t('Check for updates')}</button>;
    return h(Row, { label: productName(), hint: appHint(state) }, control);
}
// Moon Bot patch: the Office preview engine is downloaded after install (app/src/engines.mjs).
function EngineRow({ Row, run }: {
    Row: RowLike;
    run: RunWork;
}) {
    const bridge = (typeof window === 'undefined' ? null : (window.dsBotApp?.engine as AppEngineBridge | undefined) ?? null);
    const [state, setState] = useState<AppEngineState | null>(null);
    useEffect(() => {
        if (!bridge)
            return undefined;
        let live = true;
        bridge.state().then((value) => { if (live)
            setState(value); }, () => { });
        const off = bridge.onChange((value) => { if (live)
            setState(value); });
        return () => { live = false; off?.(); };
    }, [bridge]);
    if (!bridge || !state || state.phase === 'unsupported')
        return null;
    const hint = state.phase === 'ready' ? t('Ready')
        : state.phase === 'downloading' ? t('Downloading {percent}%', { percent: Math.floor(state.percent ?? 0) })
            : state.phase === 'unpacking' ? t('Unpacking…')
                : state.phase === 'error' ? `${t('Download failed.')} ${state.error ?? ''}`
                    : t('Downloaded in the background the first time it is needed (about 70 MB).');
    const control = state.phase === 'idle' || state.phase === 'error'
        ? <button type='button' className='bt-soft bt-soft-sm' onClick={() => run(bridge.download().then(setState))}>{state.phase === 'error' ? t('Try again') : t('Download now')}</button> : null;
    return h(Row, { label: t('Office file previews'), hint }, control);
}
const linkProps = (href: string): Record<string, string> => ({ className: 'bt-soft bt-soft-sm bt-about-link', href, target: '_blank', rel: 'noopener noreferrer' });
export function AboutPage({ useUpdate, actions, run, Section, Row }: {
    useUpdate: <T>(select: (value: AboutUpdate) => T) => T;
    actions: AboutActions;
    run: RunWork;
    Section: SectionLike;
    Row: RowLike;
}) {
    const update: AboutUpdate = useUpdate(value => value) ?? {};
    // Moon Bot patch: in the app, the version shown is the app's.
    const [appVersion, setAppVersion] = useState('');
    useEffect(() => { appBridge()?.state().then(value => setAppVersion(value?.current ?? ''), () => { }); }, []);
    const [checking, setChecking] = useState(false);
    const [stars, setStars] = useState<number | null>(null);
    useEffect(() => {
        let live = true;
        actions.repoStars().then((count) => { if (live && Number.isInteger(count))
            setStars(count); }, () => { });
        return () => { live = false; };
    }, []);
    // The whale hops when the page opens, after a check, and when an update is in.
    const [cheer, setCheer] = useState(true);
    useEffect(() => {
        if (!cheer)
            return undefined;
        const timer = setTimeout(() => setCheer(false), CHEER_MS);
        return () => clearTimeout(timer);
    }, [cheer]);
    const check = () => {
        setChecking(true);
        void run(actions.checkUpdate()).then((done) => { setChecking(false); if (done)
            setCheer(true); });
    };
    const phase = update.phase ?? 'idle';
    useEffect(() => { if (phase === 'installed')
        setCheer(true); }, [phase]);
    const botControl = phase === 'installed' || update.source === 'app' ? null
        : update.available || phase === 'installing'
            ? <button type='button' className='bt-fb-primary' disabled={phase === 'installing'} onClick={() => run(actions.installUpdate())}>{phase === 'installing' ? t('Updating…') : phase === 'failed' ? t('Try again') : t('Update')}</button> : <button type='button' className='bt-soft bt-soft-sm' disabled={checking || update.enabled === false} onClick={check}>{checking ? t('Checking…') : t('Check for updates')}</button>;
    const repo = update.repoUrl;
    return [
        <div key='hero' className='bt-about-hero'><span className='bt-about-mark'><MoonBotMark size={52} /></span><div className='bt-about-copy'><span className='bt-about-name'>{productName()}</span>{appVersion || update.current ? <span className='bt-about-version'>{t('Version {version}', { version: appVersion || update.current })}</span> : null}</div>{repo ? <a className='bt-star' href={repo} target='_blank' rel='noopener noreferrer' title={t('Star Moon Bot on GitHub')} aria-label={stars === null ? t('Star Moon Bot on GitHub') : `${t('Star Moon Bot on GitHub')} · ${t('{count} stars', { count: stars })}`}><span className='bt-star-main'><span className='bt-star-icon'><StarLineIcon /></span>Star</span>{stars === null ? null : <span className='bt-star-count'>{starCount(stars)}</span>}</a> : null}</div>,
        repo ? <p key='ask' className='bt-about-ask'>{t('If Moon Bot helps you, a star on GitHub helps more people find it.')}</p> : null,
        update.source === 'web' ? h(Section, { key: 'updates', title: t('Updates') }, h(Row, { label: productName(), hint: botHint(update) }))
            : h(Section, { key: 'updates', title: t('Updates') }, appBridge() ? <AppUpdateRow Row={Row} run={run} /> : null, <EngineRow Row={Row} run={run} />, appBridge() ? null : h(Row, { label: productName(), hint: botHint(update) }, botControl, update.available && update.notesUrl ? <a {...linkProps(update.notesUrl)}>{t("What's new")}</a> : null)),
        h(Section, { key: 'links', title: t('Links') }, repo ? h(Row, { label: t('Source code'), hint: repo.replace(/^https:\/\//, '') }, <a {...linkProps(repo)}><GitHubMark />{t('Open')}</a>) : null, update.notesUrl ? h(Row, { label: t('Release notes') }, <a {...linkProps(update.notesUrl)}>{t('Open')}</a>) : null, 
        h(Row, { label: t('Runtime'), hint: t("Moon Bot's own runtime with built-in and ACP engines.") }, <span>Apache-2.0</span>), h(Row, { label: t('Report a problem') }, <button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.openSettings('feedback')}>{t('Open')}</button>)),
    ];
}
export const ABOUT_CSS = `
.bt-app-progress{display:inline-block;width:140px;height:6px;border-radius:999px;background:var(--bt-line);overflow:hidden}
.bt-app-progress>span{display:block;height:100%;background:var(--bt-accent);transition:width .3s}
.bt-about-hero{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.bt-about-mark{flex:none;display:inline-flex;position:relative}
.bt-about-mark::before{content:'';position:absolute;inset:-20%;border-radius:50%}
body:not([data-bt-motion=quiet]) .bt-about-mark:hover .bt-mark[data-live][data-state=idle]:not(.bt-mark-poke) .bt-b{rotate:8deg;translate:5% -1%;animation:bt-nuzzle .78s ease-in-out .32s infinite}
body:not([data-bt-motion=quiet]) .bt-about-mark:hover .bt-mark[data-live][data-state=idle] .bt-eye{scale:1 0;animation:none}
body:not([data-bt-motion=quiet]) .bt-about-mark:hover .bt-mark[data-live][data-state=idle] .bt-eye-happy{opacity:1;transition-delay:.1s}
.bt-about-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bt-about-name{font-size:16px;line-height:22px;font-weight:600}
.bt-about-version{font-size:12px;line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-about-ask{margin:-10px 4px 0;font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-star{flex:none;display:inline-flex;align-items:stretch;height:30px;border-radius:999px;border:1px solid var(--bt-line-2,var(--bt-line));overflow:hidden;color:var(--bt-ink);text-decoration:none;font-size:12px;line-height:28px;transition:transform .12s ease,border-color .15s ease}
.bt-star:hover{border-color:color-mix(in srgb,#e3a008 55%,var(--bt-line))}
.bt-star:active{transform:scale(.96)}
.bt-star-main{display:inline-flex;align-items:center;gap:6px;padding:0 12px 0 10px;background:var(--bt-hover);font-weight:500}
.bt-star-icon{display:inline-flex;color:var(--bt-ink-2);transition:color .15s ease}
.bt-star-icon path{transition:fill .15s ease}
.bt-star:hover .bt-star-icon{color:#e3a008;animation:bt-star-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-star:hover .bt-star-icon path{fill:currentColor}
.bt-star-count{display:inline-flex;align-items:center;padding:0 11px;border-left:1px solid var(--bt-line-2,var(--bt-line));color:var(--bt-ink-2);font-variant-numeric:tabular-nums;animation:bt-star-count-in ${SPRING_POP.duration}ms ${SPRING_POP.easing},bt-veil-in .2s ease-out}
@keyframes bt-star-pop{from{scale:.6;rotate:-30deg}}
@keyframes bt-star-count-in{from{translate:-6px 0}}
.bt-about-link{display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.bt-about-link svg{width:14px;height:14px}
.bt-fb-primary:disabled{opacity:.6;cursor:default;filter:none}
@media (prefers-reduced-motion:reduce){.bt-star:hover .bt-star-icon,.bt-star-count{animation:none}}
`;
