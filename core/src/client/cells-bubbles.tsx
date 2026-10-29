import { createElement as h, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownText } from './dsh-primitives.tsx';
import { inkText } from './inks.ts';
import { BotMark, colorOf } from './mark.tsx';
import { t } from './i18n.ts';
import { clockLabel, elapsedLabel, linkMentions, mentionTarget, messageClock } from './text.ts';
import { SmileIcon, ReplyIcon, DotsIcon, CheckIcon, DownloadIcon, CopyIcon } from './icons.tsx';
import { FOLD_AT, useFold } from './fold.tsx';
import type { FoldLimit, WholeText } from './fold.tsx';
import type { QuestionActions } from './questions.tsx';
import { useMenuKeys } from './overlay-hooks.ts';
import type { SecretActions, SecretBot, SecretRoster } from './secret-card.tsx';
import type { WidgetActions, WidgetCell } from './widget-cell.tsx';
import type { ChatItem } from './cells-chat.tsx';
// -------------------------------------------------------------------------
// The shapes the transcript cells share: the roster and actions a cell reads,
// the Bots and rooms it names, and the hooks it is handed.
/** A store hook: one selected slice of the client's state, re-rendered on change. */
export type StoreHook<T> = <R>(select: (state: T) => R) => R;
/** A Bot as a cell draws it: the mark it shows, and the ids its actions take. */
export interface ChatBot extends SecretBot {
    color?: unknown;
    avatar?: unknown;
}
/** A group chat as a cell draws it. */
export interface ChatRoom {
    id?: string | undefined;
    name?: string | undefined;
    admin?: string | undefined;
    members: readonly string[];
}
/** A pending card as the roster keeps it, by the call that asked. */
export interface ChatQuestion {
    id: string;
    callId?: string | undefined;
}
/** A part of a Bot's chat, and the turn the cells of that part belong to. */
export interface TurnInfo {
    turn: number;
    status?: string | undefined;
    start?: {
        time?: number | undefined;
    } | undefined;
    end?: {
        time?: number | undefined;
    } | undefined;
}
export interface NodeLocation {
    kind?: string | undefined;
    turn?: TurnInfo | undefined;
}
/** What a cell reads of the team roster. */
export interface ChatRoster extends SecretRoster {
    byId: Record<string, ChatBot | undefined>;
    bots: readonly ChatBot[];
    rooms: readonly ChatRoom[];
    roomsById: Readonly<Record<string, ChatRoom | undefined>>;
    exchangeTurns: Readonly<Record<string, readonly number[] | undefined>>;
    questions?: Readonly<Record<string, ChatQuestion | undefined>> | undefined;
    views?: Parameters<typeof WidgetCell>[0]['roster']['views'];
}
/** One entry of the activity row's live table. */
export interface LiveNote {
    text?: true | undefined;
    thinking?: true | undefined;
    relay?: true | undefined;
    label?: string | null | undefined;
    state?: string | undefined;
}
/** One reply in a group chat's round, as the host lists it. */
export interface GroupReply {
    kind?: string | undefined;
    botId: string;
    text: string;
    name?: string | undefined;
    color?: unknown;
    code?: string | undefined;
    status?: string | undefined;
    time?: number | undefined;
    duration?: number | undefined;
}
/** A member's messages in a row, as one block under its name. */
export interface ReplyBlock {
    reply: GroupReply;
    index: number;
    texts: string[];
    time?: number | undefined;
    duration?: number | undefined;
}
/** A group's round as the progress poll lists it. */
export interface RoomProgress {
    callId?: string | undefined;
    replies?: readonly GroupReply[] | undefined;
    speaking?: string | null | undefined;
}
/** A page of a chat's earlier entries, as the host lists them. */
export interface EarlierPage {
    readonly items: readonly ChatItem[];
    readonly cursor?: string | undefined;
    readonly startedAt?: number | undefined;
}
/** What a cell reads of the UI store: the reactions it shows and the visits it marks. */
export interface Visit {
    seen?: number | undefined;
    entered: number;
}
export interface CellsUiState {
    reactions?: Readonly<Record<string, readonly (readonly string[])[] | undefined>> | undefined;
    visits?: Readonly<Record<string, Visit | undefined>> | undefined;
}
/** The actions the transcript calls: navigation, requests, and the notes it keeps. */
export interface CellActions extends SecretActions, WidgetActions, QuestionActions {
    openSession(id: string | undefined): void;
    openExchange(a: string | null | undefined, b: string | null | undefined): void;
    openMemory(id: string): void;
    toggleReaction(msgKey: string, index: number, emoji: string): void;
    quote(sessionId: string, text: string): void;
    earlier(sessionId: string, cursor?: string | undefined): Promise<EarlierPage>;
    fileText(file: string | undefined): Promise<{
        readonly text: string;
        readonly whole: boolean;
    } | undefined | null>;
    noteTurnPeer(sessionId: string, turn: number | undefined, peer: string | undefined): void;
    noteTurnTime(sessionId: string, turn: number | undefined, edge: 'first' | 'end', time: number | undefined): void;
    noteLive(sessionId: string, id: string, entry: LiveNote | null): void;
    noteCards?(sessionId: string, callIds: readonly string[], delta: number): void;
    roomProgress(sessionId: string): Promise<readonly RoomProgress[] | null | undefined>;
    showDetails(sessionId: string): void;
}
export interface BubblesProps {
    texts: readonly string[];
    roster: ChatRoster;
    selfId: string | undefined;
    actions: CellActions;
    streaming?: boolean | undefined;
    sessionId?: string | undefined;
    msgKey?: string | undefined;
    useUi?: StoreHook<CellsUiState> | undefined;
    lead?: ReactNode;
    mentions?: unknown;
    /** Mention candidates for a group; unlike the full roster this is room-scoped. */
    mentionBots?: readonly ChatBot[] | undefined;
    everyoneBots?: readonly ChatBot[] | undefined;
    fold?: FoldLimit | undefined;
    whole?: WholeText | undefined;
}
/** The message tools' popover: its styles carry a transform origin as a custom property. */
interface PopoverPlace extends CSSProperties {
    '--bt-origin'?: string | undefined;
}
interface BubbleProps {
    text: string;
    index: number;
    roster: ChatRoster;
    selfId: string | undefined;
    actions: CellActions;
    sessionId?: string | undefined;
    msgKey?: string | undefined;
    mentions?: unknown;
    mentionBots?: readonly ChatBot[] | undefined;
    everyoneBots?: readonly ChatBot[] | undefined;
    fold: FoldLimit;
    picked: readonly string[];
    live?: boolean | undefined;
    lead?: ReactNode;
    whole?: WholeText | undefined;
}
interface MessageToolsProps {
    text: string;
    name: string;
    sessionId?: string | undefined;
    react?: ((emoji: string) => void) | undefined;
    actions: CellActions;
}
/** A Bot as an event line names it: the mark, its name, and the id its chat opens by. */
interface GroupSender {
    id: string;
    name?: string | undefined;
    color?: unknown;
    avatar?: unknown;
}
interface GroupMessageProps {
    bot: GroupSender;
    text?: string | undefined;
    texts?: readonly string[] | undefined;
    room?: ChatRoom | undefined;
    roster: ChatRoster;
    actions: CellActions;
    msgKey?: string | undefined;
    useUi?: StoreHook<CellsUiState> | undefined;
    whole?: WholeText | undefined;
    time?: number | undefined;
    duration?: number | undefined;
    mentionBots?: readonly ChatBot[] | undefined;
    everyoneBots?: readonly ChatBot[] | undefined;
}
// -------------------------------------------------------------------------
// Chat cells
export const mdLabels = () => ({ code: { copyLabel: t('Copy'), copiedLabel: t('Copied') }, footnotes: t('Footnotes') });
// `lead` (a sender avatar in group chats) sits beside the last bubble, in the same
// row, so it lines up with the bubble whether or not reactions hang below it.
// `fold`: past what a bubble folds (fold.js); `whole`: the last text is only the start
// of its message (see useFold).
/** The message bubbles of one turn. A caller passes only what it has: streaming, session
 * and fold props stay optional, as their defaults say.
 */
export function Bubbles({ texts, roster, selfId, actions, streaming, sessionId, msgKey, useUi, lead, mentions, mentionBots = roster.bots, everyoneBots, fold = FOLD_AT, whole }: BubblesProps) {
    const onClick = (event: ReactMouseEvent): void => {
        const target = mentionTarget(event.nativeEvent);
        if (target === null)
            return;
        event.preventDefault();
        event.stopPropagation();
        actions.openSession(target);
    };
    const reactions = useUi ? useUi(state => (msgKey ? state.reactions?.[msgKey] ?? null : null)) : null;
    return <div className='bt-astack' data-lead={lead ? '' : undefined} onClickCapture={onClick}>{texts.map((text, index) => {
        const last = index === texts.length - 1;
        return <Bubble key={index} text={text} index={index} roster={roster} selfId={selfId} actions={actions} sessionId={sessionId} msgKey={msgKey} mentions={mentions} mentionBots={mentionBots} everyoneBots={everyoneBots} fold={fold} picked={msgKey ? reactions?.[index] ?? [] : []} live={streaming && last} lead={lead && last ? lead : null} whole={last ? whole : undefined} />;
    })}</div>;
}
function Bubble({ text, index, roster, selfId, actions, sessionId, msgKey, mentions, mentionBots = roster.bots, everyoneBots, fold, picked, live, lead, whole }: BubbleProps) {
    const { shown, folded, control } = useFold(text, { limit: fold, ...(whole === undefined ? {} : { whole }), ...(live === undefined ? {} : { live }) });
    const key = msgKey ? `${msgKey}:${index}` : undefined;
    const body = <MarkdownText text={linkMentions(shown, mentionBots, selfId, everyoneBots)} streaming={live} labels={mdLabels()} variant='compact' fileMentions={mentions} />;
    return <div className='bt-msg'><div className='bt-msg-line'>{lead}<div className='bt-bubble' data-folded={folded || undefined}>{control ? <div className='bt-fold-body'>{body}</div> : body}{control}</div>{live ? null : <MessageTools text={folded ? text : shown} name={(selfId === undefined ? undefined : roster.byId[selfId])?.name ?? t('Bot')} sessionId={sessionId} react={key && msgKey !== undefined ? emoji => actions.toggleReaction(msgKey, index, emoji) : undefined} actions={actions} />}</div>{picked.length && msgKey !== undefined ? <div className='bt-reacts'>{picked.map(emoji => <button key={emoji} type='button' className='bt-react' aria-label={t('Remove reaction {emoji}', { emoji })} onClick={() => actions.toggleReaction(msgKey, index, emoji)}>{emoji}</button>)}</div> : null}</div>;
}
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
// Closes a popover on a press outside the given elements or on Escape.
function useDismiss(open: boolean, close: () => void, refs: readonly RefObject<HTMLElement | null>[]): void {
    useEffect(() => {
        if (!open)
            return undefined;
        const onDown = (event: MouseEvent): void => {
            const target = event.target;
            if (target instanceof Node && refs.some(ref => ref.current?.contains(target)))
                return;
            close();
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                const trigger = refs[0]?.current?.querySelector<HTMLElement>('[aria-expanded="true"]');
                close();
                trigger?.focus();
            }
        };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey, true);
        return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
    }, [open]);
}
// The hover toolbar beside a reply bubble: Add reaction, Reply, More.
function MessageTools({ text, name, sessionId, react, actions }: MessageToolsProps) {
    const [panel, setPanel] = useState<string | null>(null);
    const [place, setPlace] = useState<PopoverPlace | null>(null);
    const [copied, setCopied] = useState(false);
    const tools = useRef<HTMLDivElement | null>(null);
    const pop = useRef<HTMLDivElement | null>(null);
    const close = (): void => setPanel(null);
    useDismiss(panel !== null, close, [tools, pop]);
    useMenuKeys(pop, panel !== null);
    const open = (kind: string, event: ReactMouseEvent<HTMLElement>): void => {
        if (panel === kind) {
            close();
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const below = rect.bottom + 220 < window.innerHeight;
        setPlace(kind === 'react'
            ? { left: rect.left + rect.width / 2, top: rect.top - 6, '--bt-origin': 'bottom center' }
            : { left: Math.min(rect.left, window.innerWidth - 208), ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4, '--bt-origin': 'bottom left' }) });
        setPanel(kind);
    };
    const copy = (): void => {
        void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000); });
    };
    const download = (): void => {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: `${name}-message.md` });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const item = (label: string, Icon: () => ReactNode, run: () => void): ReturnType<typeof h> => <button key={label} type='button' role='menuitem' onClick={() => { close(); run(); }}>{h(Icon)}{label}</button>;
    return <div ref={tools} className='bt-tools' data-open={panel !== null || undefined}>{react ? <button type='button' className='bt-tool' aria-label={t('Add reaction')} title={t('Add reaction')} aria-expanded={panel === 'react'} onClick={event => open('react', event)}><SmileIcon /></button> : null}{sessionId ? <button type='button' className='bt-tool' aria-label={t('Reply')} title={t('Reply')} onClick={() => actions.quote(sessionId, text)}><ReplyIcon /></button> : null}<button type='button' className='bt-tool' aria-label={t('More message actions')} title={t('More')} aria-haspopup='menu' aria-expanded={panel === 'more'} onClick={event => open('more', event)}>{copied ? <CheckIcon /> : <DotsIcon />}</button>{panel === 'react' ? createPortal(<div ref={pop} className='bt-react-strip' role='menu' aria-label={t('Reactions')} style={place ?? undefined}>{REACTIONS.map(emoji => <button key={emoji} type='button' role='menuitem' aria-label={emoji} onClick={() => { close(); react?.(emoji); }}>{emoji}</button>)}</div>, document.body) : null}{panel === 'more' ? createPortal(<div ref={pop} className='bt-menu' role='menu' aria-label={t('Message actions')} style={place ?? undefined}>{item(t('Copy'), CopyIcon, copy)}{item(t('Download'), DownloadIcon, download)}</div>, document.body) : null}</div>;
}
// One Bot message inside a group chat: avatar, name (with its group role), when it ran
// and how long it took, bubble.
export function GroupMessage({ bot, text = '', texts = [text], room, roster, actions, msgKey, useUi, whole, time, duration }: GroupMessageProps) {
    const memberBots = room?.members.map(id => roster.byId[id]).filter((item): item is ChatBot => item !== undefined) ?? roster.bots;
    const lead = <button type='button' className='bt-lead' aria-label={t("Open {name}'s chat", { name: bot.name })} onClick={() => actions.openSession(bot.id)}><BotMark bot={bot} size={22} /></button>;
    const took = duration !== undefined && Number.isFinite(duration) ? elapsedLabel(duration) : undefined;
    return <div className='bt-group-msg'><span className='bt-group-name' style={{ color: inkText(colorOf(bot)) }}>{bot.name}{room?.admin === bot.id ? <span className='bt-group-role'>{t('Admin')}</span> : null}{time !== undefined && Number.isFinite(time) ? <span className='bt-group-time' title={clockLabel(time)}>{messageClock(time)}</span> : null}{took ? <span className='bt-group-took' title={t('Ran for {duration}', { duration: took })}>{took}</span> : null}</span><Bubbles texts={texts} roster={roster} selfId={bot.id} actions={actions} sessionId={room?.id} msgKey={msgKey} useUi={useUi} lead={lead} whole={whole} mentionBots={memberBots} everyoneBots={room ? memberBots : undefined} /></div>;
}
// A member's messages in a row, as one block under its name: what it says while it
// works comes one message at a time. A block carries the last message's time and run.
export function stackReplies(replies: readonly GroupReply[]): ReplyBlock[] {
    const items: ReplyBlock[] = [];
    replies.forEach((reply, index) => {
        const last = items.at(-1);
        if (reply.kind === undefined && last !== undefined && last.reply.kind === undefined && last.reply.botId === reply.botId) {
            last.texts.push(reply.text);
            last.time = reply.time;
            last.duration = reply.duration;
        }
        else
            items.push({ reply, index, texts: reply.kind === undefined ? [reply.text] : [], time: reply.time, duration: reply.duration });
    });
    return items;
}
