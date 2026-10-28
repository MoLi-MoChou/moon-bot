// The Bot panel: one right-hand column holding a Bot's details or its browser.
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { reducedMotion, SPRING_SHAPE } from './motion.tsx';
import { DetailsDrawer } from './details-drawer.tsx';
import { useEscape } from './overlay-hooks.ts';
import { t } from './i18n.ts';
import type { BotPanelProps, PanelActions, PanelView, } from './browser-pane-types.ts';
import { BrowserView, PanelStrip, chatRoom, fitWidth, isCssAnimation, savedWidth, widthRange, } from './browser-pane-chrome.tsx';
import { DEFAULT_WIDTH, DETAILS_WIDTH, EMPTY_PAGE, EMPTY_TABS, OPEN_ENTRIES, READ_FLASH_MS, WIDTH_KEY, } from './browser-pane-const.ts';
export { PANEL_LINGER_MS } from './browser-pane-const.ts';
export function BotPanel({ pane, leaving, roster, actions, useSessions, useSessionStatus, useActivity, useWork, useBrowserTabs, useBrowserPages }: BotPanelProps) {
    const bot = roster.byId[pane.id];
    const canBrowse = Boolean(bot && roster.browser === true && actions.browserShow);
    const view: PanelView = pane.view === 'browser' && canBrowse ? 'browser' : 'details';
    useEscape(() => actions.closeOverlay(), !leaving && view === 'browser');
    const tabState = useBrowserTabs(map => (bot ? (map[bot.id] ?? EMPTY_TABS) : EMPTY_TABS));
    const active = tabState.active;
    const page = useBrowserPages(pages => (active ? pages[active] : null) ?? EMPTY_PAGE);
    const root = useRef<HTMLElement | null>(null);
    const fly = useRef<{
        node: HTMLElement;
        from: DOMRect;
    } | null>(null);
    const [landed, setLanded] = useState(false);
    const [settling, setSettling] = useState(false);
    const [width, setWidth] = useState<number | null>(savedWidth);
    const [viewport, setViewport] = useState(() => window.innerWidth);
    // While dragging or while the window resizes, width changes land at once.
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const instant = dragging || resizing;
    const [reading, setReading] = useState(false);
    const panelWidth = fitWidth(width ?? (view === 'browser' ? DEFAULT_WIDTH : DETAILS_WIDTH), widthRange(view, viewport));
    // Once the browser has shown, the Bot page keeps its width (up to DETAILS_MAX).
    useLayoutEffect(() => { if (view === 'browser' && width === null)
        setWidth(DEFAULT_WIDTH); }, [view, width]);
    useLayoutEffect(() => { chatRoom.hold(instant); }, [instant]);
    // A view switch that changes the width holds the guest back and pins both views to
    // the final width until the panel edge has settled. It is set while rendering, so the
    // switch's own commit is already pinned and the flying mark measures where its target
    // ends up, not where it sits before the pin.
    const [last, setLast] = useState({ view, width: panelWidth });
    if (last.view !== view || last.width !== panelWidth) {
        setLast({ view, width: panelWidth });
        if (last.view !== view)
            setSettling(last.width !== panelWidth && !instant);
    }
    // Such a switch gives the conversation its new width at once, so it reflows once
    // instead of every frame of the glide. Opening and closing glide it with the panel.
    const shownView = useRef<PanelView>(view);
    useLayoutEffect(() => {
        const switched = settling && shownView.current !== view;
        shownView.current = view;
        if (switched)
            chatRoom.hold(true);
        chatRoom.set(leaving ? null : panelWidth);
        if (switched)
            chatRoom.hold(false);
    }, [view, panelWidth, leaving]);
    useEffect(() => () => { chatRoom.set(null); chatRoom.hold(false); }, []);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onResize = (): void => {
            setResizing(true);
            setViewport(window.innerWidth);
            clearTimeout(timer);
            timer = setTimeout(() => setResizing(false), 160);
        };
        window.addEventListener('resize', onResize);
        return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
    }, []);
    useEffect(() => {
        if (!settling)
            return undefined;
        const timer = setTimeout(() => setSettling(false), SPRING_SHAPE.duration + 40);
        return () => clearTimeout(timer);
    }, [settling, view]);
    useEffect(() => {
        const timer = setTimeout(() => setLanded(true), 360);
        return () => clearTimeout(timer);
    }, []);
    // A Bot's strip restores as soon as the panel opens for it.
    useEffect(() => { if (canBrowse && bot)
        actions.browserEnsure(bot.id); }, [bot?.id, canBrowse]);
    // With the last tab closed the browser view folds back into the details view.
    useEffect(() => {
        if (view === 'browser' && (active === null || !tabState.ids.includes(active)))
            actions.setPanelView('details');
    }, [view, active, tabState.ids.length]);
    // The guest leaves the screen while the details view is up, and on close.
    useEffect(() => {
        if (view !== 'browser' || leaving)
            void actions.browserShow?.(null);
    }, [view, leaving]);
    useEffect(() => () => { void actions.browserShow?.(null); }, []);
    useEffect(() => {
        if (!page.readAt || Date.now() - page.readAt > READ_FLASH_MS)
            return undefined;
        setReading(true);
        const timer = setTimeout(() => setReading(false), READ_FLASH_MS);
        return () => clearTimeout(timer);
    }, [page.readAt]);
    // A view switch flies the Bot's mark between the drawer avatar and the strip,
    // and the outgoing view fades out over the incoming one at its own width.
    const beginSwitch = (next: PanelView): void => {
        if (reducedMotion())
            return;
        const panel = root.current;
        const outgoing = panel?.querySelector<HTMLElement>('.bt-panel-view');
        if (outgoing) {
            const ghostEl = document.createElement('div');
            ghostEl.className = 'bt-panel-ghost';
            ghostEl.style.width = `${outgoing.offsetWidth}px`;
            ghostEl.append(outgoing.cloneNode(true));
            outgoing.parentElement?.append(ghostEl);
            void ghostEl.animate([
                { opacity: 1, transform: 'scale(1)' },
                { opacity: 0, transform: 'scale(0.985)' },
            ], { duration: 160, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => { }).finally(() => ghostEl.remove());
        }
        const source = next === 'browser'
            ? panel?.querySelector<HTMLElement>('.bt-drawer-id .bt-mark')
            : panel?.querySelector<HTMLElement>('.bt-ptab-bot .bt-mark');
        if (source) {
            const clone = source.cloneNode(true);
            if (clone instanceof HTMLElement)
                fly.current = { node: clone, from: source.getBoundingClientRect() };
        }
    };
    const switchView = (next: PanelView): void => {
        if (next === view || leaving)
            return;
        beginSwitch(next);
        actions.setPanelView(next);
    };
    // Every path into the browser view (globe, card, +) animates the same collapse.
    const panelActions: PanelActions = { ...actions };
    for (const name of OPEN_ENTRIES) {
        if (actions[name])
            panelActions[name] = (...args: unknown[]) => {
                if (view !== 'browser')
                    beginSwitch('browser');
                return actions[name]?.(...args);
            };
    }
    useLayoutEffect(() => {
        const move = fly.current;
        if (!move)
            return;
        fly.current = null;
        const target = view === 'browser'
            ? root.current?.querySelector<HTMLElement>('.bt-ptab-bot .bt-mark')
            : root.current?.querySelector<HTMLElement>('.bt-drawer-id .bt-mark');
        if (!target || move.from.width === 0 || reducedMotion())
            return;
        const panel = root.current;
        if (!panel)
            return;
        // A strip that has just appeared still grows from zero height; the target is
        // measured where it stands once the strip is full height.
        const growing = panel.getAnimations({ subtree: true }).filter(animation => isCssAnimation(animation) && animation.animationName === 'bt-strip-in');
        const at = new Map(growing.map(animation => [animation, animation.currentTime]));
        for (const animation of growing) {
            const end = animation.effect?.getComputedTiming().endTime;
            if (end !== undefined)
                animation.currentTime = end;
        }
        const to = target.getBoundingClientRect();
        for (const animation of growing) {
            const start = at.get(animation);
            if (start !== undefined)
                animation.currentTime = start;
        }
        const clone = move.node;
        Object.assign(clone.style, {
            position: 'fixed', left: `${move.from.left}px`, top: `${move.from.top}px`,
            width: `${move.from.width}px`, height: `${move.from.height}px`, margin: '0',
            transformOrigin: '0 0', zIndex: '80', pointerEvents: 'none', visibility: '',
        });
        document.body.append(clone);
        target.style.visibility = 'hidden';
        const scale = to.width / move.from.width;
        const anim = clone.animate([
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${to.left - move.from.left}px, ${to.top - move.from.top}px) scale(${scale})` },
        ], { duration: SPRING_SHAPE.duration, easing: SPRING_SHAPE.easing, fill: 'forwards' });
        void anim.finished.catch(() => { }).finally(() => { clone.remove(); target.style.visibility = ''; });
    }, [view, pane.id]);
    // A drag writes the width into the panel's and the column's own inline styles each
    // frame (each restyles one element) and renders once, on release.
    const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0 || leaving)
            return;
        event.preventDefault();
        const panel = root.current;
        if (!panel)
            return;
        const grip = event.currentTarget;
        grip.setPointerCapture?.(event.pointerId);
        const range = widthRange(view, window.innerWidth);
        const from = { x: event.clientX, width: panelWidth };
        let next = panelWidth;
        setDragging(true);
        setSettling(false);
        chatRoom.hold(true);
        const columns = chatRoom.columns();
        for (const column of columns)
            column.style.setProperty('transition', 'none', 'important');
        const onMove = (move: PointerEvent): void => {
            next = fitWidth(from.width + from.x - move.clientX, range);
            panel.style.width = `${next}px`;
            if (columns.length === 0)
                chatRoom.set(next);
            for (const column of columns)
                column.style.setProperty('margin-right', `${next}px`, 'important');
        };
        const ends = ['pointerup', 'pointercancel', 'lostpointercapture'];
        const onEnd = (end: Event): void => {
            if (end.type === 'pointerup' && end instanceof PointerEvent)
                onMove(end);
            grip.removeEventListener('pointermove', onMove);
            for (const name of ends)
                grip.removeEventListener(name, onEnd);
            // Hand the width back to the rule and the panel's variable in the same frame.
            chatRoom.set(next);
            for (const column of columns) {
                column.style.removeProperty('margin-right');
                column.style.removeProperty('transition');
            }
            panel.style.setProperty('--bt-panel-w', `${next}px`);
            panel.style.removeProperty('width');
            setDragging(false);
            if (next === from.width)
                return;
            setWidth(next);
            try {
                localStorage.setItem(WIDTH_KEY, String(next));
            }
            catch { /* storage unavailable */ }
        };
        grip.addEventListener('pointermove', onMove);
        for (const name of ends)
            grip.addEventListener(name, onEnd);
    };
    const hasStrip = canBrowse && tabState.ids.length > 0;
    return <aside ref={root} className='bt-panel' data-view={view} aria-label={view === 'browser' && bot ? t("{name}'s browser", { name: bot.name }) : t('Conversation details')} data-leaving={leaving || undefined} aria-hidden={leaving || undefined} data-settling={settling || undefined} data-instant={instant || undefined} data-dragging={dragging || undefined} style={{ '--bt-panel-w': `${panelWidth}px` }} onAnimationEnd={(event) => { if (event.target === event.currentTarget)
        setLanded(true); }}>{leaving ? null : <div className='bt-panel-grip' role='separator' aria-orientation='vertical' aria-label={t('Resize panel')} onPointerDown={startResize}/>}{
    // Over the whole window while dragging: the cursor stays a resize cursor and the
    // pages underneath (the chat, the guest) see no pointer.
    dragging ? createPortal(<div className='bt-drag-shield' aria-hidden/>, document.body) : null}{hasStrip && bot ? <PanelStrip bot={bot} subject={pane.id} view={view} ids={tabState.ids} active={active} reading={reading} onView={switchView} actions={panelActions} useBrowserPages={useBrowserPages} /> : null}{view === 'browser' && bot
        ? <BrowserView key={`browser:${active}`} bot={bot} tabId={active} leaving={leaving} landed={landed && !settling} actions={actions} useBrowserPages={useBrowserPages} />
        : <div key={`details:${pane.id}:${pane.renaming ? 'rename' : ''}:${pane.tab ?? ''}`} className='bt-panel-view'>{h(DetailsDrawer, {
            sessionId: pane.id, startRenaming: pane.renaming, startTab: pane.tab, hasStrip,
            roster, actions: panelActions, useSessions, useSessionStatus, useActivity, useWork, useBrowserTabs, useBrowserPages,
        })}</div>}</aside>;
}
export type { BrowserPagesHook, BrowserTabsHook, ForwardedHook, PanelActions, PanelBot, PanelRoster, PanelView, PanelPage, PanelPages, PanelTabs, BotPanelProps, } from './browser-pane-types.ts';
export { Favicon, GlobeIcon } from './browser-pane-chrome.tsx';
