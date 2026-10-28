import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MarkdownText } from './dsh-primitives.tsx';
import { language, t } from './i18n.ts';
import { failureLabel } from './diagnostics.ts';
import { clockLabel, dayLabel, elapsedLabel } from './text.ts';
import { FOLD_HUGE, useFold } from './fold.tsx';
import { AnsweredReply } from './widget-cell.tsx';
import { BotMark, RoomAvatar } from './mark.tsx';
import { Bubbles, mdLabels } from './cells-bubbles.tsx';
import type { CellActions, CellsUiState, ChatRoom, ChatRoster, StoreHook } from './cells-bubbles.tsx';
// A pause longer than this splits the transcript with a time separator.
export const SEPARATOR_GAP_MS = 30 * 60 * 1000;
// -------------------------------------------------------------------------
// A Bot chat's entries, as the host lists them
export interface ChatBotItem {
    kind: 'bot';
    text: string;
    time?: number | undefined;
}
export interface ChatUserItem {
    kind: 'user';
    text?: string | undefined;
    images?: number | undefined;
    time?: number | undefined;
}
export interface ChatDividerItem {
    kind: 'divider';
    time?: number | undefined;
}
/** The answered-reply payload a chat row carries; the renderer takes it whole. */
type AnswerData = NonNullable<NonNullable<NonNullable<Parameters<typeof AnsweredReply>[0]>['node']>['data']>;
export type ChatAnswerItem = {
    kind: 'answer';
    time?: number | undefined;
} & AnswerData;
export interface ChatEventItem {
    kind: 'event';
    role?: string | undefined;
    roomId?: string | undefined;
    botId?: string | undefined;
    name?: string | undefined;
    time?: number | undefined;
}
/**
 * A turn that failed: the code names the reason (`NO-MODEL`, `AUTH`, `TRANSPORT`…), and
 * `text` is the model's own words when it left any. A person sees the reason, not the
 * code; a quiet failure the user could not see was the bug this row exists for.
 */
export interface ChatErrorItem {
    kind: 'error';
    code?: string | undefined;
    text?: string | undefined;
    time?: number | undefined;
}
export type ChatItem = ChatBotItem | ChatUserItem | ChatDividerItem | ChatAnswerItem | ChatEventItem | ChatErrorItem;
export interface ChatStackedBot {
    kind: 'bot';
    texts: string[];
    time?: number | undefined;
    end?: number | undefined;
}
export type ChatStackedRow = ChatStackedBot | Exclude<ChatItem, ChatBotItem>;
export interface ChatRowsProps {
    items: readonly ChatItem[];
    sessionId: string;
    roster: ChatRoster;
    actions: CellActions;
    useUi?: StoreHook<CellsUiState> | undefined;
    clock?: boolean | undefined;
}
interface PartLineProps {
    time?: number | undefined;
}
interface EarlierView {
    items: readonly ChatItem[];
    cursor?: string | undefined;
    loading: boolean;
    failed: boolean;
    startedAt?: number | undefined;
}
interface ChatRowContext {
    sessionId: string;
    selfId: string | undefined;
    roster: ChatRoster;
    actions: CellActions;
    useUi?: StoreHook<CellsUiState> | undefined;
}
export interface ShimmerProps {
    children?: ReactNode;
}
export interface ElapsedProps {
    at: number;
    className?: string | undefined;
}
interface EarlierUserProps {
    row: ChatUserItem;
}
interface EarlierPartsProps {
    sessionId: string;
    roster: ChatRoster;
    actions: CellActions;
}
function PartLine({ time }: PartLineProps) {
    return <div className='bt-part-line' role='separator'>{time !== undefined && Number.isFinite(time) ? <span>{dayLabel(time)}</span> : null}</div>;
}
const scrollParent = (node: Element | null): Element | null => {
    for (let at = node?.parentElement ?? null; at; at = at.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(at).overflowY))
            return at;
    }
    return null;
};
function EarlierUser({ row }: EarlierUserProps) {
    const { shown, folded, control } = useFold(row.text ?? '');
    const body = row.text ? <MarkdownText text={shown} labels={mdLabels()} variant='compact' /> : null;
    return <div className='bt-urow'><div className='bt-ububble' data-folded={folded || undefined}>{control ? <div className='bt-fold-body'>{body}</div> : body}{control}{row.images ? <span className='bt-uimages'>{row.images === 1 ? t('1 image') : t('{count} images', { count: row.images })}</span> : null}</div></div>;
}
// The chat line a failed turn leaves: what failed, in words a person reads, and the
// model's own text under it when that says more. `failureLabel` keeps the words for a
// code; the code itself never reaches the chat.
export interface TurnErrorRowProps {
    code?: string | undefined;
    text?: string | undefined;
}
export function TurnErrorRow({ code, text }: TurnErrorRowProps) {
    const words = text?.trim() ?? '';
    const reason = code !== undefined ? failureLabel(code, words === '' ? undefined : words) : words !== '' ? words : t('Unknown error');
    // The model's own words under the sentence, when they say more. In Chinese they are
    // left out unless they are Chinese too: the sentence already says what happened.
    const more = words !== '' && words.toLowerCase() !== reason.trim().toLowerCase();
    const detail = more && (!language().startsWith('zh') || code === undefined || /[一-鿿]/.test(words)) ? words : undefined;
    return <div className='bt-turn-error' role='alert' data-code={code}>
        <span className='bt-turn-error-title'>{t('Model request failed')}</span>
        <span className='bt-turn-error-why'>{reason}</span>
        {detail !== undefined ? <span className='bt-turn-error-detail'>{detail}</span> : null}
    </div>;
}
// The earlier parts of a Bot's own chat, above its current part as one conversation.
// Pages load from the host as the user scrolls up; a thin line marks where each
// part begins, the last one where the current part begins.
export function EarlierParts({ sessionId, roster, actions }: EarlierPartsProps) {
    const [view, setView] = useState<EarlierView>({ items: [], cursor: undefined, loading: true, failed: false, startedAt: undefined });
    const top = useRef<HTMLDivElement | null>(null);
    const busy = useRef(false);
    const alive = useRef(true);
    const restore = useRef<{
        scroller: Element;
        fromEnd: number;
    } | null>(null);
    const load = (cursor: string | undefined): void => {
        if (busy.current)
            return;
        busy.current = true;
        setView(current => ({ ...current, loading: true, failed: false }));
        actions.earlier(sessionId, cursor).then((page) => {
            busy.current = false;
            if (!alive.current)
                return;
            // The chat's scroller does not anchor content prepended above the viewport,
            // so the page keeps its distance from the end by hand.
            const scroller = top.current === null ? null : scrollParent(top.current);
            if (scroller)
                restore.current = { scroller, fromEnd: scroller.scrollHeight - scroller.scrollTop };
            setView(current => ({ items: [...page.items, ...current.items], cursor: page.cursor, loading: false, failed: false, startedAt: page.startedAt ?? current.startedAt }));
        }, () => {
            busy.current = false;
            if (alive.current)
                setView(current => ({ ...current, loading: false, failed: true }));
        });
    };
    useEffect(() => {
        alive.current = true;
        load(undefined);
        return () => { alive.current = false; };
    }, [sessionId]);
    useLayoutEffect(() => {
        const pending = restore.current;
        restore.current = null;
        if (pending)
            pending.scroller.scrollTop = pending.scroller.scrollHeight - pending.fromEnd;
    }, [view.items]);
    useEffect(() => {
        const node = top.current;
        const cursor = view.cursor;
        if (!node || view.loading || view.failed || cursor === undefined || typeof IntersectionObserver !== 'function')
            return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting))
                load(cursor);
        }, { root: scrollParent(node), rootMargin: '600px 0px 0px 0px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [view.cursor, view.loading, view.failed]);
    return <div className='bt-earlier' role='feed' aria-label={t('Earlier messages')} aria-busy={view.loading}><div ref={top} className='bt-earlier-top'>{view.loading ? <Shimmer>{t('Loading earlier messages…')}</Shimmer>
        : view.failed ? <button type='button' className='bt-soft' onClick={() => load(view.cursor)}>{t('Couldn’t load earlier messages · Retry')}</button> : view.cursor ? <button type='button' className='bt-soft' onClick={() => load(view.cursor)}>{t('Load earlier')}</button> : null}</div>{h(ChatRows, { items: view.items, sessionId, roster, actions })}<PartLine time={view.startedAt} /></div>;
}
// A Bot chat's entries as the host lists them (the `earlier` and `chat` endpoints): the
// Bot's messages in a row are one block, and a thin line marks where a part begins.
// `clock` adds the time separators: one above the first entry, and one after each pause.
export function stackChatItems(items: readonly ChatItem[]): ChatStackedRow[] {
    const rows: ChatStackedRow[] = [];
    for (const item of items) {
        const last = rows.at(-1);
        if (item.kind === 'bot' && last !== undefined && last.kind === 'bot') {
            last.texts.push(item.text);
            last.end = item.time;
        }
        else
            rows.push(item.kind === 'bot' ? { kind: 'bot', texts: [item.text], time: item.time, end: item.time } : item);
    }
    return rows;
}
export function ChatRows({ items, sessionId, roster, actions, useUi, clock = false }: ChatRowsProps) {
    const selfId = roster.byId[sessionId]?.id;
    const rows = useMemo(() => stackChatItems(items), [items]);
    let before: number | undefined;
    return rows.flatMap((row, index) => {
        // Pages are prepended, so a row keeps its distance from the end.
        const key = rows.length - index;
        const shown = chatRow(row, key, { sessionId, selfId, roster, actions, useUi });
        // A part's first entry shows its time under the part's line, as a chat's first one does.
        if (row.kind === 'divider') {
            before = undefined;
            return [shown];
        }
        const at = row.time;
        const pause = clock && at !== undefined && Number.isFinite(at) && (before === undefined || at - before >= SEPARATOR_GAP_MS);
        const stamp = (row.kind === 'bot' ? row.end : undefined) ?? row.time;
        if (stamp !== undefined && Number.isFinite(stamp))
            before = stamp;
        return pause && at !== undefined ? [<div key={`${key}:clock`} className='bt-time-sep' role='separator'>{clockLabel(at)}</div>, shown] : [shown];
    });
}
// `useUi` gives a block its reactions and its Reply tool.
function chatRow(row: ChatStackedRow, key: number, { sessionId, selfId, roster, actions, useUi }: ChatRowContext) {
    switch (row.kind) {
        case 'divider': return <PartLine key={key} time={row.time} />;
        case 'user': return <EarlierUser key={key} row={row} />;
        case 'answer': return <AnsweredReply key={key} node={{ data: row }} />;
        case 'bot': return <Bubbles key={key} texts={row.texts} roster={roster} selfId={selfId} actions={actions} sessionId={useUi ? sessionId : undefined} msgKey={useUi ? `${sessionId}:${row.time}` : undefined} useUi={useUi} fold={FOLD_HUGE} />;
        case 'error':
            return <TurnErrorRow key={key} code={row.code} text={row.text} />;
        case 'event': {
            if (row.role === 'report')
                return <GroupEvent key={key} prefix={t('Replies from')} room={row.roomId === undefined ? undefined : roster.roomsById[row.roomId]} name={t('a group chat')} roster={roster} actions={actions} />;
            const known = row.botId === undefined ? undefined : roster.byId[row.botId];
            const other = known ?? { id: row.botId ?? '', name: row.name ?? t('a Bot'), color: 'gray' };
            const prefix = row.role === 'stopped' ? t('Stopped by') : row.role === 'reply' ? t('Reply from') : t('Message from');
            return <EventLine key={key} prefix={prefix} bots={[other]} onOpen={() => { if (selfId && other.id)
                    actions.openExchange(selfId, other.id); }} whole />;
        }
        default: return null;
    }
}
/** A Bot as an event line names it: the mark, its name, and the id its chat opens by. */
export interface EventBot {
    id?: string;
    name: string;
    color?: unknown;
    avatar?: unknown;
}
interface MarkProps {
    name: string;
    id?: string;
    color?: unknown;
    avatar?: unknown;
}
/** The mark props of an event Bot: no id property when the Bot had none. */
const markOf = (bot: EventBot): MarkProps => (bot.id === undefined
    ? { name: bot.name, color: bot.color, avatar: bot.avatar }
    : { name: bot.name, id: bot.id, color: bot.color, avatar: bot.avatar });
export interface EventLineProps {
    prefix: string;
    bots: readonly EventBot[];
    joiner?: string;
    onOpen?: ((bot: EventBot) => void) | undefined;
    whole?: boolean;
}
export function EventLine({ prefix, bots, joiner = t('and'), onOpen, whole = false }: EventLineProps) {
    const only = bots[0];
    if (whole && bots.length === 1 && only !== undefined) {
        return <div className='bt-event'><button type='button' className='bt-event-whole' title={only.name} onClick={() => onOpen?.(only)}><span>{prefix}</span><BotMark bot={markOf(only)} size={16} /><span className='bt-event-name'>{only.name}</span></button></div>;
    }
    const parts: ReactNode[] = [];
    parts.push(<span key='p'>{prefix}</span>);
    bots.forEach((bot, index) => {
        if (index > 0)
            parts.push(<span key={`j${index}`}>{joiner}</span>);
        parts.push(<button key={bot.id ?? index} type='button' onClick={() => onOpen?.(bot)}><BotMark bot={markOf(bot)} size={16} />{bot.name}</button>);
    });
    return <div className='bt-event'>{parts}</div>;
}
export interface GroupEventProps {
    prefix: string;
    room?: ChatRoom | undefined;
    name?: string | undefined;
    roster: ChatRoster;
    actions: CellActions;
}
// A centered event line that names a group chat and opens it.
export function GroupEvent({ prefix, room, name, roster, actions }: GroupEventProps) {
    return <div className='bt-event'><span>{prefix}</span>{room ? <button type='button' onClick={() => actions.openSession(room.id)}><RoomAvatar room={room} roster={roster} size={16} />{room.name}</button> : name ? <span>{name}</span> : null}</div>;
}
export function Shimmer({ children }: ShimmerProps) {
    return <span className='bt-shimmer'>{children}</span>;
}
// The time since `at`, from 1s. It ticks on its own whole seconds, so its parent does
// not render again each second.
export function Elapsed({ at, className }: ElapsedProps) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = (): void => {
            const time = Date.now();
            setNow(time);
            timer = setTimeout(tick, 1000 - (((time - at) % 1000) + 1000) % 1000);
        };
        tick();
        return () => { if (timer !== undefined)
            clearTimeout(timer); };
    }, [at]);
    return <span className={className}>{`· ${elapsedLabel(Math.max(1000, now - at))}`}</span>;
}
