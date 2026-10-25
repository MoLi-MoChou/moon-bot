// The activity row: the Bot's mark and a shimmering phrase at the transcript tail while
// it works. It lives in the shell's running status, steps aside while a reply streams,
// and holds each phrase long enough to read.
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BotMark, RoomAvatar } from './mark.tsx';
import type { BotMarkProps, RoomAvatarProps } from './mark.tsx';
import { Elapsed, Shimmer, PHRASES } from './cells.ts';
import { reducedMotion } from './motion.tsx';
import { t } from './i18n.ts';
const PHRASE_HOLD_MS = 800;
// A phrase that stays this long gives way to another one of the same kind, so a long
// wait still reads as alive.
const PHRASE_ROTATE_MS = 3200;
/** One entry of the live table: a Bot's row in the transcript while a turn runs. */
interface LiveEntry {
    text?: string | undefined;
    thinking?: boolean | undefined;
    relay?: boolean | undefined;
    label?: string | undefined;
    state?: string | undefined;
    at?: number | undefined;
}
/** What the roster hook hands the row: the Bot of an own chat, or the room of a group. */
interface RosterState {
    byId: Record<string, BotMarkProps['bot']>;
    roomsById: Record<string, RoomAvatarProps['room'] | undefined>;
}
interface PendingSubmission {
    readonly placement?: string | undefined;
    readonly time: number;
}
interface SessionSnapshot {
    readonly pendingSubmissions?: readonly PendingSubmission[] | undefined;
}
/** A store hook: one selected slice of the shell's state, re-rendered on change. */
type StoreHook<T> = <R>(select: (state: T) => R) => R;
export interface ActivityIndicatorProps {
    sessionId: string;
    useRoster: StoreHook<RosterState>;
    useSessionStatus: StoreHook<ReadonlyMap<string, {
        readonly running?: boolean | undefined;
    }>>;
    useLive?: StoreHook<Record<string, LiveEntry>>;
    useSession: StoreHook<SessionSnapshot | null | undefined>;
    useWork?: StoreHook<{
        readonly turns?: Readonly<Record<string, number | undefined>> | undefined;
    }>;
    actions: {
        clearLive(sessionId: string): void;
    };
}
// DSH puts the shell's running status in the transcript column, either directly or
// inside a slot wrapper (DSH 0.2.1 wraps it in a [data-slot] div). The row must find it
// either way; a direct-child-only selector left the row unmounted, so nothing showed
// between sending and the first streamed text.
export function runningSlot(root: ParentNode): Element | null {
    return root.querySelector('[data-chat-flow] [data-chat-running]');
}
// The rows of a transcript column: its own [data-chat-flow-key] items, wrapped or not.
export function flowRows(column: Element): HTMLElement[] {
    return [...column.querySelectorAll<HTMLElement>('[data-chat-flow-key]')].filter(item => item.parentElement?.closest('[data-chat-flow-key], [data-chat-flow]') === column);
}
const drawPhrase = (pool: readonly string[]): string => t(pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))] as string) as string;
export { reducedMotion };
function useRunningHost(active: boolean): Element | null {
    const [host, setHost] = useState<Element | null>(null);
    useEffect(() => {
        if (!active) {
            setHost(null);
            return undefined;
        }
        let frame = 0;
        const find = (): void => {
            frame = 0;
            const node = runningSlot(document);
            setHost(prev => (prev === node ? prev : node));
        };
        const observer = new MutationObserver(() => { if (!frame)
            frame = requestAnimationFrame(find); });
        observer.observe(document.querySelector('[data-conversation-scroll]') ?? document.body, { childList: true, subtree: true });
        find();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, [active]);
    return host;
}
// New rows slide in. The first paint of a transcript, history
// loaded above, and bulk loads arrive without motion.
function useRowEntrances(replacing: () => boolean): void {
    const check = useRef(replacing);
    check.current = replacing;
    useEffect(() => {
        const seen = new WeakSet<Element>();
        const started = Date.now();
        let column: Element | null = null;
        let frame = 0;
        const settle = (event: AnimationEvent): void => {
            if (event.target !== event.currentTarget || !event.animationName.startsWith('bt-row'))
                return;
            const row = event.currentTarget as HTMLElement;
            delete row.dataset.btEnter;
            row.removeEventListener('animationend', settle);
        };
        const scan = (): void => {
            frame = 0;
            const next = document.querySelector('[data-chat-flow]');
            if (next !== column) {
                observer.disconnect();
                column = next;
                if (column)
                    observer.observe(column, { childList: true });
            }
            if (!column)
                return;
            const items = flowRows(column);
            let last = -1;
            const fresh: {
                item: HTMLElement;
                index: number;
            }[] = [];
            items.forEach((item, index) => {
                if (seen.has(item))
                    last = index;
                else if (item.offsetHeight > 0)
                    fresh.push({ item, index });
            });
            for (const { item } of fresh)
                seen.add(item);
            if (last < 0 || Date.now() - started < 800 || fresh.length > 3)
                return;
            for (const { item, index } of fresh) {
                if (index < last)
                    continue;
                const reply = [undefined, 'assistant-step', 'tool-call'].includes(item.dataset.chatFlowKind);
                item.dataset.btEnter = reply && check.current() ? 'after-collapse' : 'new';
                item.addEventListener('animationend', settle);
            }
        };
        const observer = new MutationObserver(() => { if (!frame)
            frame = requestAnimationFrame(scan); });
        scan();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, []);
}
/** One phrase on screen: what it says, and when it went up. */
interface ShownPhrase {
    key: string;
    text: string;
    at: number;
}
/** What the row should be saying, before the phrase is drawn. */
interface WantPhrase {
    key: string;
    pool: readonly string[];
    state: string;
    label?: string | undefined;
}
export function ActivityIndicator({ sessionId, useRoster, useSessionStatus, useLive, useSession, useWork, actions }: ActivityIndicatorProps) {
    const roster = useRoster(value => value);
    const running = useSessionStatus(map => map.get(sessionId)?.running === true);
    const turnAt = useWork?.(work => work.turns?.[sessionId]);
    // Until the host reports the turn's start, the clock counts from when this window
    // saw the run begin.
    const runAt = useRef(0);
    if (!running)
        runAt.current = 0;
    else if (runAt.current === 0)
        runAt.current = Date.now();
    const liveKey = useLive?.(state => JSON.stringify(state[sessionId] ?? {})) ?? '{}';
    // A queued message waits for the next turn, so only a transcript or steering
    // send counts as fresh input.
    const pendingInput = useSession(snapshot => Math.max(0, ...(snapshot?.pendingSubmissions ?? [])
        .filter(sub => sub.placement !== 'queued').map(sub => sub.time)));
    const bot = roster.byId[sessionId];
    const room = roster.roomsById[sessionId];
    const entries = useMemo(() => Object.values(JSON.parse(liveKey) as Record<string, LiveEntry>), [liveKey]);
    const streaming = entries.some(entry => entry.text);
    const tools = entries.filter(entry => !entry.text && !entry.thinking).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    // Group chats show who is typing on their own while members speak.
    const relaying = tools.some(entry => entry.relay);
    const visible = running && !streaming && !relaying && (bot !== undefined || room !== undefined);
    const tool = tools.at(-1);
    const inputRef = useRef(0);
    // A steer keeps the run going, so nothing else resets the row: fresh input is
    // the newest activity, and the phrase and the clock restart from the send.
    const inputAt = Math.max(inputRef.current, pendingInput);
    inputRef.current = inputAt;
    const want: WantPhrase | null = !visible ? null
        : inputAt > (tool?.at ?? 0)
            ? { key: `input:${inputAt}`, pool: PHRASES.thinking, state: 'thinking' }
            : tool ? { key: tool.label ? `tool:${tool.label}` : 'working', ...(tool.label === undefined ? {} : { label: tool.label }), pool: PHRASES.working, state: tool.state ?? 'working' }
                : { key: 'thinking', pool: PHRASES.thinking, state: 'thinking' };
    const [shown, setShown] = useState<ShownPhrase | null>(null);
    const wantKey = want?.key ?? null;
    const markState = useRef('thinking');
    if (want)
        markState.current = want.state;
    useEffect(() => {
        if (wantKey === null || shown?.key === wantKey || want === null)
            return undefined;
        const make = (): void => setShown({ key: wantKey, text: want.label ?? drawPhrase(want.pool), at: Date.now() });
        const wait = shown ? shown.at + PHRASE_HOLD_MS - Date.now() : 0;
        if (wait <= 0) {
            make();
            return undefined;
        }
        const timer = setTimeout(make, wait);
        return () => clearTimeout(timer);
    }, [wantKey, shown]);
    useEffect(() => {
        if (!shown || wantKey === null || want === null || shown.key !== wantKey || want.label || reducedMotion())
            return undefined;
        const pool = want.pool;
        const timer = setTimeout(() => {
            let text = drawPhrase(pool);
            for (let tries = 0; text === shown.text && tries < 4; tries++)
                text = drawPhrase(pool);
            setShown({ key: wantKey, text, at: Date.now() });
        }, PHRASE_ROTATE_MS);
        return () => clearTimeout(timer);
    }, [shown, wantKey]);
    const [phase, setPhase] = useState<'in' | 'out' | null>(null);
    const endedAt = useRef(0);
    const shift = useRef<number | null>(null);
    const leaving = useRef(false);
    leaving.current = phase !== null && !visible;
    useEffect(() => {
        if (visible) {
            setPhase('in');
            return undefined;
        }
        setPhase(current => (current === 'in' ? 'out' : current));
        const timer = setTimeout(() => {
            shift.current = (document.querySelector('[data-conversation-scroll]') as HTMLElement | null)?.scrollTop ?? null;
            setPhase(current => (current === 'out' ? null : current));
        }, 140);
        return () => clearTimeout(timer);
    }, [visible]);
    // Removing the row at a pinned tail moves the transcript down; a tail
    // shift eases that collapse instead of jumping.
    useLayoutEffect(() => {
        if (phase !== null)
            return;
        endedAt.current = Date.now();
        setShown(null);
        const before = shift.current;
        shift.current = null;
        const scroller = document.querySelector('[data-conversation-scroll]') as HTMLElement | null;
        if (before === null || !scroller || reducedMotion())
            return;
        const delta = before - scroller.scrollTop;
        if (delta > 0)
            scroller.querySelector('[data-chat-flow]')?.animate([{ transform: `translateY(${-delta}px)` }, { transform: 'none' }], { duration: 140, easing: 'cubic-bezier(.23,1,.32,1)' });
    }, [phase]);
    // Cancelled tools never report a result, so their notes end with the run.
    useEffect(() => { if (!running)
        actions.clearLive(sessionId); }, [running, sessionId]);
    // Only rows that take the activity row's place grow out of it.
    useRowEntrances(() => leaving.current || Date.now() - endedAt.current < 300);
    const host = useRunningHost(running);
    if (!host || phase === null || !shown)
        return null;
    return createPortal(<div className='bt-typing' data-exiting={phase === 'out' ? '' : undefined} aria-hidden>{bot ? h(BotMark, { bot, size: 28, state: markState.current, live: true, pokeable: true }) : h(RoomAvatar, { room: room as RoomAvatarProps['room'], roster, size: 28 })}<span className='bt-typing-text'><span key={`${shown.key}:${shown.at}`} className='bt-typing-label'>{h(Shimmer, null, shown.text)}<span className='bt-dots' aria-hidden><i /><i /><i /></span></span>{h(Elapsed, { at: Math.max(turnAt ?? runAt.current, inputAt), className: 'bt-typing-time' })}</span></div>, host);
}
