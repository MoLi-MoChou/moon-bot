// Browser tab strip, toolbar, and page chrome for the Bot panel.
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BotMark } from './mark.tsx';
import { reducedMotion } from './motion.tsx';
import { EmptyState } from './empty-state.tsx';
import { t } from './i18n.ts';
import type { BrowserViewProps, FaviconProps, PanelPage, PanelStripProps, PanelView, } from './browser-pane-types.ts';
import { DETAILS_MAX, DETAILS_WIDTH, EMPTY_PAGE, MIN_CHAT, MIN_WIDTH, SPRING_LEAD, SPRING_TRAIL, WIDTH_KEY, } from './browser-pane-const.ts';
import { installStyles } from './design/index.ts';
export const icon = (paths: readonly string[]) => function BrowserIcon() {
    return <svg width={16} height={16} viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={1.5} strokeLinecap='round' strokeLinejoin='round' aria-hidden>{paths.map((d, index) => <path key={index} d={d}/>)}</svg>;
};
export const GlobeIcon = icon(['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M3 10h14', 'M10 3c2 2.2 2.9 4.5 2.9 7S12 14.8 10 17c-2-2.2-2.9-4.5-2.9-7S8 5.2 10 3z']);
export const BackIcon = icon(['M12.5 4.5L7 10l5.5 5.5']);
export const ForwardIcon = icon(['M7.5 4.5L13 10l-5.5 5.5']);
export const ReloadIcon = icon(['M15.5 10a5.5 5.5 0 1 1-1.6-3.9', 'M15.5 3.5v3.5H12']);
export const StopIcon = icon(['M5.5 5.5l9 9M14.5 5.5l-9 9']);
export const CloseIcon = icon(['M5.5 5.5l9 9M14.5 5.5l-9 9']);
export const PlusTabIcon = icon(['M10 5v10M5 10h10']);
export const LockIcon = icon(['M6.5 9V7a3.5 3.5 0 0 1 7 0v2', 'M5.5 9h9v7h-9z']);
/** A page's favicon, or the globe while there is none or it fails to load. */
export function Favicon({ src, className }: FaviconProps) {
    const [failed, setFailed] = useState<string | null>(null);
    if (!src || failed === src)
        return <span className={`${className} bt-ptab-globe`}><GlobeIcon /></span>;
    return <img className={className} src={src} alt='' aria-hidden onError={() => setFailed(src)}/>;
}
// An animation from the strip's own keyframes. Plain Animation has no animationName.
export const isCssAnimation = (animation: Animation): animation is CSSAnimation => 'animationName' in animation;
// null until the user sets a width: the Bot page then opens at DETAILS_WIDTH and the
// browser at DEFAULT_WIDTH.
export const savedWidth = (): number | null => {
    try {
        const value = Number(localStorage.getItem(WIDTH_KEY));
        return Number.isFinite(value) && value >= DETAILS_WIDTH ? value : null;
    }
    catch {
        return null;
    }
};
export const widthRange = (view: PanelView, viewport: number): [
    number,
    number
] => (view === 'browser'
    ? [MIN_WIDTH, viewport - MIN_CHAT]
    : [DETAILS_WIDTH, Math.min(DETAILS_MAX, viewport - MIN_CHAT)]);
export const fitWidth = (width: number, [low, high]: readonly [
    number,
    number
]): number => Math.round(Math.max(low, Math.min(width, high)));
// The conversation column's right margin lives in one rule of our own, matched on the
// column's exact class. A custom property on <body> would restyle the whole page, tens
// of milliseconds a write. A changed rule still restyles the column's subtree, so a drag
// writes the column's own inline style each frame and the rule once, on release.
export const room: {
    rule: CSSStyleRule | null;
    selector: string;
} = { rule: null, selector: '' };
export const roomRule = (): CSSStyleRule => {
    if (room.rule !== null && room.rule.parentStyleSheet?.ownerNode?.isConnected === true && room.selector !== '')
        return room.rule;
    const column = document.querySelector('[class*="_centerCol"]');
    const selector = column ? [...column.classList].filter(name => name.includes('_centerCol')).map(name => `.${CSS.escape(name)}`).join(',') : '';
    if (room.rule !== null && room.rule.parentStyleSheet?.ownerNode?.isConnected === true && selector === '')
        return room.rule;
    const declarations = room.rule?.style.cssText ?? '';
    room.rule?.parentStyleSheet?.ownerNode?.remove();
    const style = installStyles(`${selector || '[class*="_centerCol"]'}{${declarations}}`, 'chat-room');
    const rule = style.sheet?.cssRules[0];
    if (!(rule instanceof CSSStyleRule))
        throw new Error('the chat-room rule did not install');
    room.rule = rule;
    room.selector = selector;
    return rule;
};
export let roomHold = 0;
export const chatRoom = {
    /** The column's right margin in px, or null for the shell's own. */
    set(width: number | null): void {
        const { style } = roomRule();
        if (width === null)
            style.removeProperty('margin-right');
        else
            style.setProperty('margin-right', `${width}px`, 'important');
    },
    /** While on, a margin change lands at once instead of gliding. */
    hold(on: boolean): void {
        cancelAnimationFrame(roomHold);
        if (on) {
            roomRule().style.setProperty('transition', 'none', 'important');
            return;
        }
        // Two frames, so the last held write is on screen before the glide comes back.
        roomHold = requestAnimationFrame(() => { roomHold = requestAnimationFrame(() => roomRule().style.removeProperty('transition')); });
    },
    /** The columns themselves, for a drag's per-frame writes. */
    columns(): HTMLElement[] {
        roomRule();
        return room.selector ? [...document.querySelectorAll<HTMLElement>(room.selector)] : [];
    },
};
// The address as the bar shows it while not editing: no scheme, no trailing slash.
export const shortAddress = (url: string | null | undefined): string => String(url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
export const tabLabel = (page: PanelPage): string => page.title || shortAddress(page.url) || t('New tab');
// The strip across the panel's top: the Bot's own tab first (the details view,
// collapsed), then one tab per browser page, then new-tab and close.
export function PanelStrip({ bot, subject, view, ids, active, reading, onView, actions, useBrowserPages }: PanelStripProps) {
    const pages = useBrowserPages(map => map);
    const wrap = useRef<HTMLDivElement | null>(null);
    const ind = useRef<HTMLSpanElement | null>(null);
    const spot = useRef<{
        left: number;
        right: number;
    } | null>(null);
    const under = useRef<HTMLElement | null>(null);
    // The capsule sits under the active tab; its two edges move on different springs.
    useLayoutEffect(() => {
        const box = wrap.current;
        const capsule = ind.current;
        if (!box || !capsule)
            return undefined;
        const node = view === 'details' ? box.querySelector<HTMLElement>('.bt-ptab-bot') : box.querySelector<HTMLElement>(`[data-tab="${active}"]`);
        under.current = node;
        if (!node) {
            capsule.style.opacity = '0';
            spot.current = null;
            return undefined;
        }
        // The Bot tab is pinned at the strip's start; showing it scrolls the pages back
        // so the capsule and the pinned tab line up.
        if (view === 'details')
            box.scrollLeft = 0;
        else
            node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        const to = { left: node.offsetLeft, right: box.offsetWidth - node.offsetLeft - node.offsetWidth };
        const from = spot.current;
        spot.current = to;
        capsule.style.opacity = '1';
        capsule.style.left = `${to.left}px`;
        capsule.style.right = `${to.right}px`;
        if (from === null || (from.left === to.left && from.right === to.right) || reducedMotion())
            return undefined;
        const ahead = to.left > from.left ? 'right' : 'left';
        const behind = ahead === 'right' ? 'left' : 'right';
        const lead = capsule.animate([{ [ahead]: `${from[ahead]}px` }, { [ahead]: `${to[ahead]}px` }], { duration: SPRING_LEAD.duration, easing: SPRING_LEAD.easing });
        const trail = capsule.animate([{ [behind]: `${from[behind]}px` }, { [behind]: `${to[behind]}px` }], { duration: SPRING_TRAIL.duration, easing: SPRING_TRAIL.easing });
        return () => { lead.cancel(); trail.cancel(); };
    });
    // A drag resizes the strip without a render; the capsule's right edge keeps to its tab.
    useEffect(() => {
        const box = wrap.current;
        if (!box)
            return undefined;
        const observer = new ResizeObserver(() => {
            const node = under.current;
            const capsule = ind.current;
            if (!node?.isConnected || !capsule || spot.current === null)
                return;
            spot.current = { left: node.offsetLeft, right: box.offsetWidth - node.offsetLeft - node.offsetWidth };
            capsule.style.left = `${spot.current.left}px`;
            capsule.style.right = `${spot.current.right}px`;
        });
        observer.observe(box);
        return () => observer.disconnect();
    }, []);
    return <div className='bt-ptabs' role='tablist' aria-label={t('Panel tabs')}><div className='bt-ptabs-in' ref={wrap}><button type='button' role='tab' aria-selected={view === 'details'} className='bt-ptab bt-ptab-bot' title={bot.name} onClick={() => onView('details')}><BotMark bot={bot} size={20} state={reading ? 'searching' : 'idle'} />{view === 'details' ? <span className='bt-ptab-name'>{bot.name}</span> : null}</button>{ids.map((tabId) => {
        const page = pages[tabId] ?? EMPTY_PAGE;
        const on = view === 'browser' && tabId === active;
        return <button key={tabId} type='button' role='tab' aria-selected={on} data-tab={tabId} className='bt-ptab' title={page.url || t('New tab')} onClick={() => { actions.browserActivate(bot.id, tabId); onView('browser'); }} onAuxClick={(event) => { if (event.button === 1) {
            event.preventDefault();
            void actions.browserCloseTab(bot.id, tabId);
        } }}><Favicon src={page.favicon} className='bt-ptab-fav' /><span className='bt-ptab-title'>{tabLabel(page)}</span><span className='bt-ptab-x' role='button' aria-label={t('Close tab')} title={t('Close tab')} onClick={(event) => { event.stopPropagation(); void actions.browserCloseTab(bot.id, tabId); }}>×</span></button>;
    })}<span ref={ind} className='bt-ptab-ind' aria-hidden/></div><button type='button' className='bt-ptab-new' aria-label={t('New tab')} title={t('New tab')} onClick={() => actions.browserNewTab(subject)}><PlusTabIcon /></button><button type='button' className='bt-icon-btn bt-ptab-close' aria-label={t('Close panel')} title={t('Close panel')} onClick={() => actions.closePanel()}><CloseIcon /></button></div>;
}
// The browser view: toolbar (back, forward, reload/stop, address) over the frame
// the guest webview covers.
export function BrowserView({ bot, tabId, leaving, landed, actions, useBrowserPages }: BrowserViewProps) {
    const page = useBrowserPages(pages => pages[tabId ?? ''] ?? EMPTY_PAGE) ?? EMPTY_PAGE;
    const frame = useRef<HTMLDivElement | null>(null);
    const input = useRef<HTMLInputElement | null>(null);
    const [draft, setDraft] = useState<string | null>(null);
    // The guest goes on screen once the panel has landed and settled on its width,
    // and only over a page: the empty and error states are the panel's own.
    const showGuest = landed && !leaving && Boolean(page.url) && !page.error;
    useLayoutEffect(() => {
        const element = frame.current;
        if (!element || leaving || !tabId) {
            void actions.browserShow(null);
            return undefined;
        }
        const shownTab = tabId;
        let raf = 0;
        const measure = (): void => {
            cancelAnimationFrame(raf);
            raf = 0;
            const box = element.getBoundingClientRect();
            void actions.browserShow(shownTab, showGuest ? { left: box.left, top: box.top, width: box.width, height: box.height } : null);
        };
        const schedule = (): void => { if (!raf)
            raf = requestAnimationFrame(measure); };
        measure();
        // Measured inside the observer callback, where layout is fresh: the guest moves in
        // the same frame as the panel edge instead of one behind it.
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        window.addEventListener('resize', schedule);
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            window.removeEventListener('resize', schedule);
        };
    }, [tabId, showGuest, leaving]);
    // A fresh tab starts on its address bar.
    useEffect(() => {
        setDraft(null);
        if (landed && !page.url)
            input.current?.focus();
    }, [tabId, landed]);
    const go = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const text = draft ?? '';
        if (text.trim() === '')
            return;
        setDraft(null);
        input.current?.blur();
        void actions.browserNavigate(tabId, text).then((opened) => { if (opened)
            actions.browserFocus(tabId); });
    };
    const editing = draft !== null;
    const secure = /^https:/i.test(page.url);
    return <div className='bt-panel-view bt-panel-browser' aria-label={t("{name}'s browser", { name: bot.name })}><div className='bt-browser-bar'><button type='button' className='bt-icon-btn' aria-label={t('Back')} title={t('Back')} disabled={!page.canGoBack} onClick={() => actions.browserCommand(tabId, 'back')}><BackIcon /></button><button type='button' className='bt-icon-btn' aria-label={t('Forward')} title={t('Forward')} disabled={!page.canGoForward} onClick={() => actions.browserCommand(tabId, 'forward')}><ForwardIcon /></button><button type='button' className='bt-icon-btn' disabled={!page.url} aria-label={page.loading ? t('Stop') : t('Reload')} title={page.loading ? t('Stop') : t('Reload')} onClick={() => actions.browserCommand(tabId, page.loading ? 'stop' : 'reload')}>{h(page.loading ? StopIcon : ReloadIcon)}</button><form className='bt-browser-address' onSubmit={go} data-editing={editing || undefined}><span className='bt-browser-scheme' aria-hidden>{h(secure && !editing ? LockIcon : GlobeIcon)}</span><input ref={input} type='text' spellCheck={false} autoComplete='off' aria-label={t('Address')} placeholder={t('Search or enter address')} value={editing ? draft : shortAddress(page.url)} onFocus={(event) => { setDraft(page.url); const target = event.target; requestAnimationFrame(() => target.select()); }} onBlur={() => setDraft(null)} onChange={event => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') {
        event.stopPropagation();
        setDraft(null);
        event.currentTarget.blur();
    } }}/></form>{page.loading ? <span className='bt-browser-progress' aria-hidden/> : null}</div><div ref={frame} className='bt-browser-frame' data-guest={showGuest || undefined}>{page.error
        ? <div className='bt-browser-empty'><EmptyState icon={<GlobeIcon />} title={t('This page didn’t load')} hint={t(page.error)} {...(page.url ? { action: { label: t('Try again'), onClick: () => { void actions.browserNavigate(tabId, page.url); } } } : {})} /></div> : !page.url
        ? <div className='bt-browser-empty'><EmptyState art={<BotMark bot={bot} size={48} state='idle' live />} title={t("{name}'s browser", { name: bot.name })} hint={t('Open a page here and {name} can read it with you. Logins and cookies stay with {name}; other Bots never see them.', { name: bot.name })} action={{ label: t('Enter an address'), onClick: () => input.current?.focus() }} /></div> : null}</div></div>;
}
/**
 * One aside for the Bot's details and browser. `pane` is
 * `{ id, view: 'details'|'browser', renaming, tab }`; `id` is the Session id the
 * panel follows. Without the Desktop bridge the browser view never shows.
 */
