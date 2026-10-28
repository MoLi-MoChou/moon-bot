import { Fragment, createElement as h, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpIcon, CloseIcon, ArrowDownIcon } from './icons.tsx';
import { t } from './i18n.ts';
// The new-message pills over the transcript: "N new messages" while the user is scrolled
// away, and Back to bottom's stand-in. The header draws them; they read nothing else.
/** A store hook: one selected slice of the shell's state, re-rendered on change. */
export type StoreHook<T> = <R>(select: (state: T) => R) => R;
/** A Session as the sessions list shows it. */
interface SessionEntry {
    readonly displayTitle?: string | undefined;
    readonly title?: string | undefined;
    readonly projectionValues?: {
        readonly turnOutline?: unknown;
    } | undefined;
}
export interface SessionsState {
    readonly byId: Readonly<Record<string, SessionEntry | undefined>>;
    readonly projectionsBySession?: Readonly<Record<string, {
        readonly values?: {
            readonly turnOutline?: unknown;
        } | undefined;
    } | undefined>> | undefined;
}
/** A turn in the clock's per-Session table. */
interface ClockEntry {
    readonly first?: number | undefined;
}
export type TurnClockState = Readonly<Record<string, Readonly<Record<string, ClockEntry | undefined>> | undefined>>;
// New-message pills. "N new messages ↓" takes Back to bottom's place when
// replies land while the user is scrolled up; "N new messages ↑" points at an unread
// divider above the viewport until it has been seen. The shell shows Back to bottom
// only while unpinned, so its presence is the pinned signal.
export const OFF_BOTTOM_PX = 120;
export function isOffBottom(scroller: Element | null | undefined, threshold = OFF_BOTTOM_PX): boolean {
    if (!scroller)
        return false;
    const sh = Number(scroller.scrollHeight);
    const st = Number(scroller.scrollTop);
    const ch = Number(scroller.clientHeight);
    if (Number.isFinite(sh) && Number.isFinite(st) && Number.isFinite(ch) && sh > ch && ch > 0) {
        return sh - st - ch > threshold;
    }
    return scroller.querySelector?.('[class*="_toBottomSlot"]>button') !== null;
}
export function scrollToBottom(scroller: Element | null | undefined): void {
    if (!scroller)
        return;
    const back = scroller.querySelector<HTMLElement>('[class*="_toBottomSlot"]>button');
    if (back)
        back.click();
    scroller.scrollTo?.({ top: scroller.scrollHeight, behavior: 'smooth' });
}
export function followBottom(scroller: Element | null | undefined, wasPinned: boolean): boolean {
    if (!scroller || !wasPinned)
        return false;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (Number.isFinite(distance) && distance > 2) {
        if (typeof scroller.scrollTo === 'function')
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
        else
            scroller.scrollTop = scroller.scrollHeight;
        return true;
    }
    return false;
}
interface Visit {
    readonly seen?: number | undefined;
    readonly entered: number;
}
export interface UiState {
    readonly visits?: Readonly<Record<string, Visit | undefined>> | undefined;
    readonly details?: string | null | undefined;
    readonly view?: string | undefined;
}
/** Where the transcript column sits, and how the new-message pills place themselves. */
interface TranscriptView {
    readonly unpinned: boolean;
    readonly divider: 'above' | 'below' | 'in-view' | null;
    readonly center: number;
    readonly top: number;
    readonly bottom: number;
}
function useTranscriptView(): TranscriptView | null {
    const [view, setView] = useState<TranscriptView | null>(null);
    useEffect(() => {
        let frame = 0;
        let watched: Element | null = null;
        let composerHeight = 152;
        const readComposer = (scroller: Element | null) => {
            if (!scroller || typeof getComputedStyle !== 'function')
                return;
            composerHeight = parseFloat(getComputedStyle(scroller).getPropertyValue('--dsh-composer-height')) || 152;
        };
        const observer = new MutationObserver(() => schedule());
        const measure = () => {
            frame = 0;
            const scroller = document.querySelector('[data-conversation-scroll]');
            const flow = scroller?.querySelector('[data-chat-flow]') ?? scroller;
            if (flow !== watched) {
                observer.disconnect();
                watched = flow;
                readComposer(scroller);
                if (flow)
                    observer.observe(flow, { childList: true });
            }
            if (!scroller) {
                setView(null);
                return;
            }
            const box = scroller.getBoundingClientRect();
            const headerBottom = document.querySelector<HTMLElement>('header[class*="_header"]')?.getBoundingClientRect().bottom ?? box.top + 50;
            const sep = scroller.querySelector('.bt-new-sep');
            let divider: TranscriptView['divider'] = null;
            if (sep) {
                const at = sep.getBoundingClientRect();
                divider = at.bottom <= headerBottom ? 'above' : at.top >= box.bottom ? 'below' : 'in-view';
            }
            const next: TranscriptView = {
                unpinned: isOffBottom(scroller),
                divider,
                center: Math.round(box.left + box.width / 2),
                top: Math.round(headerBottom + 8),
                bottom: Math.round(window.innerHeight - box.bottom + composerHeight + 8),
            };
            setView(prev => (prev !== null
                && prev.unpinned === next.unpinned && prev.divider === next.divider
                && prev.center === next.center && prev.top === next.top && prev.bottom === next.bottom ? prev : next));
        };
        const schedule = () => { if (!frame)
            frame = requestAnimationFrame(measure); };
        const onResize = () => { readComposer(document.querySelector('[data-conversation-scroll]')); schedule(); };
        document.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', onResize);
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            document.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', onResize);
        };
    }, []);
    return view;
}
interface NewMessagePillsProps {
    sessionId: string;
    useSessions: StoreHook<SessionsState>;
    useUi: StoreHook<UiState>;
    useTurnClock: StoreHook<TurnClockState>;
}
interface Release {
    readonly base: number | null;
    readonly dismissed: boolean;
}
interface Above {
    readonly seen: boolean;
    readonly dismissed: boolean;
}
export function NewMessagePills({ sessionId, useSessions, useUi, useTurnClock }: NewMessagePillsProps) {
    const replies = useSessions((list) => {
        const outline = list.projectionsBySession?.[sessionId]?.values?.turnOutline ?? list.byId[sessionId]?.projectionValues?.turnOutline;
        return Array.isArray(outline) ? outline.reduce((count: number, entry: {
            readonly response?: unknown;
        }) => count + (entry.response ? 1 : 0), 0) : 0;
    });
    const visit = useUi(state => state.visits?.[sessionId]);
    const unread = useTurnClock((state) => {
        if (typeof visit?.seen !== 'number')
            return 0;
        let count = 0;
        for (const entry of Object.values(state[sessionId] ?? {})) {
            if (entry !== undefined && entry.first !== undefined && entry.first > visit.seen && entry.first <= visit.entered)
                count += 1;
        }
        return count;
    });
    const view = useTranscriptView();
    const unpinned = view?.unpinned === true;
    const pinnedRef = useRef(true);
    pinnedRef.current = !unpinned;
    const [release, setRelease] = useState<Release>({ base: null, dismissed: false });
    const [above, setAbove] = useState<Above>({ seen: false, dismissed: false });
    useEffect(() => { setRelease({ base: unpinned ? replies : null, dismissed: false }); }, [unpinned]);
    useEffect(() => {
        if (pinnedRef.current)
            followBottom(document.querySelector('[data-conversation-scroll]'), true);
    }, [replies]);
    useEffect(() => { if (view?.divider === 'in-view')
        setAbove(state => (state.seen ? state : { ...state, seen: true })); }, [view?.divider]);
    const fresh = release.base === null ? 0 : replies - release.base;
    const showDown = unpinned && fresh > 0 && !release.dismissed;
    const showBack = unpinned && !showDown;
    const showUp = view?.divider === 'above' && !above.seen && !above.dismissed;
    useEffect(() => {
        const scroller = document.querySelector('[data-conversation-scroll]');
        if (!scroller)
            return undefined;
        scroller.toggleAttribute('data-bt-news', showDown || showBack);
        return () => scroller.removeAttribute('data-bt-news');
    }, [showDown, showBack]);
    if (!view || (!showDown && !showBack && !showUp))
        return null;
    const label = (count: number) => (count === 1 ? t('1 new message') : count > 0 ? t('{count} new messages', { count }) : t('New messages'));
    const pill = (direction: 'up' | 'down', count: number, style: CSSProperties, onJump: () => void, onDismiss: () => void) => <div className='bt-news' data-direction={direction} style={style}><button type='button' className='bt-news-jump' onClick={onJump}><span className='bt-news-ico'>{h(direction === 'up' ? ArrowUpIcon : ArrowDownIcon)}</span>{label(count)}</button><button type='button' className='bt-news-x' aria-label={t('Dismiss new messages')} onClick={(event: {
        stopPropagation(): void;
    }) => { event.stopPropagation(); onDismiss(); }}><CloseIcon /></button></div>;
    const toLatest = () => scrollToBottom(document.querySelector('[data-conversation-scroll]'));
    const toDivider = () => document.querySelector('[data-conversation-scroll] .bt-new-sep')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return createPortal(<>{showUp ? pill('up', unread, { left: view.center, top: view.top }, toDivider, () => setAbove(state => ({ ...state, dismissed: true }))) : null}{showDown ? pill('down', fresh, { left: view.center, bottom: view.bottom }, toLatest, () => setRelease(state => ({ ...state, dismissed: true }))) : null}{showBack ? <div className='bt-to-bottom' style={{ left: view.center, bottom: view.bottom }}><button type='button' className='bt-to-bottom-btn' aria-label={t('Back to bottom')} onClick={toLatest}><span className='bt-news-ico'><ArrowDownIcon /></span>{t('Back to bottom')}</button></div> : null}</>, document.body);
}
