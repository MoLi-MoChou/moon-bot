import { Fragment, createElement as h, useEffect, useLayoutEffect } from 'react';
import { t } from './i18n.ts';
import { clockLabel, commRunOf, contentText, isHiddenTurn, isRelayContext, reminderPrompts, stripHeader } from './text.ts';
import { stripLongNote } from './fold.tsx';
import { FileCards, useTurnFiles } from './deliver-cards.tsx';
import { GroupMessage } from './cells-bubbles.tsx';
import { EventLine, GroupEvent } from './cells-chat.tsx';
import type { CellActions, CellsUiState, ChatBot, ChatRoster, NodeLocation, StoreHook, Visit } from './cells-bubbles.tsx';
import type { SessionsState } from './header-pills.tsx';
import { EarlierParts, SEPARATOR_GAP_MS } from './cells-chat.tsx';
/** A trigger's content blocks: text, or the file a long post went as. */
interface TriggerBlock {
    type?: string;
    text?: string;
    attachment?: string;
}
/** The source a trigger node carries: which kind of run it opens, and from whom. */
export interface TriggerSource {
    kind?: string;
    handoff?: boolean;
    deferred?: boolean;
    resumed?: boolean;
    retried?: boolean;
    stopped?: boolean;
    done?: boolean;
    logged?: unknown;
    failed?: unknown;
    role?: string;
    length?: number;
    roomId?: string;
    senderSessionId?: string;
    senderName?: string;
}
export interface TriggerData {
    turn?: number;
    time?: number;
    seq?: number;
    content?: readonly TriggerBlock[];
    source?: TriggerSource | null;
}
export interface TriggerNode {
    key?: string | number | undefined;
    data: TriggerData;
    location?: NodeLocation | undefined;
}
/** One turn in the clock's per-Session table. */
export interface TurnClockEntry {
    first?: number | undefined;
    end?: number | undefined;
    peer?: string | undefined;
}
export type TurnTable = Readonly<Record<string, TurnClockEntry | undefined>>;
export type TurnClockState = Readonly<Record<string, TurnTable | undefined>>;
/** The fold state of a running turn's process, as the host keeps it. */
export interface TurnProcess {
    foldable?: boolean | undefined;
    open?: boolean | undefined;
    setOpen(open: boolean): void;
}
export interface TriggerCellProps {
    node: TriggerNode;
    sessionId: string;
    useRoster: StoreHook<ChatRoster>;
    useSessions: StoreHook<SessionsState>;
    useTurnClock: StoreHook<TurnClockState>;
    useUi: StoreHook<CellsUiState>;
    actions: CellActions;
}
export interface TurnProcessCellProps {
    node?: {
        location?: NodeLocation | undefined;
        data?: {
            turn?: number | undefined;
        } | undefined;
    } | undefined;
    sessionId: string;
    turnProcess?: TurnProcess | undefined;
    useRoster: StoreHook<ChatRoster>;
    useUi: StoreHook<CellsUiState>;
    useTurnClock: StoreHook<TurnClockState>;
    actions: CellActions;
}
export interface TurnTailCellProps {
    turn: {
        turn: number;
        end: {
            time: number;
        };
    };
    sessionId: string;
    useTurnClock: StoreHook<TurnClockState>;
    useUi: StoreHook<CellsUiState>;
    actions: CellActions;
}
export function TriggerCell({ node, sessionId, useRoster, useSessions, useTurnClock, useUi, actions }: TriggerCellProps) {
    const roster = useRoster(value => value);
    const data = node.data;
    const source: TriggerSource = data.source !== null && typeof data.source === 'object' ? data.source : {};
    // Team state (exchanges) is keyed by the Bot id; Session state by the part shown.
    const selfId = roster.byId[sessionId]?.id ?? sessionId;
    // A resumed handoff keeps the relayed message's source, but it opens a part, not a run.
    // A deferred request was already shown where the Bot read it mid-turn; the turn
    // that answers it adds no second line.
    const deferred = source.kind === 'bot' && source.deferred === true;
    const relayed = isRelayContext(data);
    const turn = node.location?.turn?.turn ?? data.turn;
    // Noted before paint so a folded line never flashes in before its run's first line.
    useLayoutEffect(() => {
        if (relayed)
            actions.noteTurnPeer(sessionId, turn, source.senderSessionId);
    }, [relayed, sessionId, turn, source.senderSessionId]);
    const order = useSessions((list) => {
        const outline = list.projectionsBySession?.[sessionId]?.values?.turnOutline ?? list.byId[sessionId]?.projectionValues?.turnOutline;
        return Array.isArray(outline) ? outline.map((entry: {
            turn?: number | undefined;
        }) => entry.turn).join(',') : '';
    });
    const peers = useTurnClock((state) => {
        if (!relayed)
            return '';
        const turns = state[sessionId] ?? {};
        return Object.keys(turns).filter(key => turns[key]?.peer !== undefined).map(key => `${key}:${turns[key]?.peer}`).join(',');
    });
    // A conversation opened for the first time since it began starts under the
    // unread divider, with its opening time below it.
    const visit = useUi(state => state.visits?.[sessionId]);
    const hiddenTurns = roster.exchangeTurns[sessionId];
    const unreadOpening = useTurnClock((state) => {
        const first = openingTurn(state[sessionId], order, hiddenTurns);
        return first !== null && first.turn === turn && unseenSince(visit, first.start) ? clockLabel(first.start) : '';
    });
    const body = triggerBody();
    return unreadOpening
        ? <><div className='bt-open-new'>{h(NewDivider)}<div className='bt-time-sep' role='separator'>{unreadOpening}</div></div>{body}</> : body;
    function triggerBody() {
        if (source.kind === 'bot') {
            // A part opens with its handoff package, so the earlier parts go right above it.
            if (source.handoff === true)
                return roster.roomsById[sessionId] ? null : h(EarlierParts, { sessionId, roster, actions });
            // Group turns belong to the group chat; the member's own chat stays one-to-one.
            if (source.role === 'kickoff' || source.role === 'room')
                return null;
            // The secret card itself shows what the user did; the note to the Bot stays out.
            if (source.role === 'secret' || deferred)
                return null;
            if (source.role === 'post') {
                // A post logged into a running round already shows there, not again as a trigger.
                if (source.logged !== undefined)
                    return null;
                // A member's late failure, its work picked up after a restart, its work the user
                // stopped, or the end of its work shows as an event of the round it opens.
                if (source.failed !== undefined || source.resumed === true || source.stopped === true || source.done === true)
                    return null;
                const room = roster.roomsById[sessionId];
                const poster = (source.senderSessionId === undefined ? undefined : roster.byId[source.senderSessionId]) ?? { id: source.senderSessionId ?? '', name: source.senderName ?? t('a Bot'), color: 'gray' };
                // A post past what a message holds came as a file, with its start only.
                const file = source.length === undefined ? undefined : (data.content ?? []).find(block => block?.type === 'file')?.attachment;
                const text = stripHeader(contentText(data.content));
                // A trigger's data carries no turn; its event seq is the one durable name of this post.
                return h(GroupMessage, {
                    bot: poster, text: file ? stripLongNote(text) : text, room, roster, actions, msgKey: `${sessionId}:post:${data.seq ?? node.key}`, useUi, time: data.time,
                    whole: file && source.length !== undefined ? { length: source.length, load: () => actions.fileText(file) } : undefined,
                });
            }
            if (source.role === 'report') {
                return h(GroupEvent, { prefix: t('Replies from'), room: source.roomId === undefined ? undefined : roster.roomsById[source.roomId], name: t('a group chat'), roster, actions });
            }
            // A request carried on keeps its role, but its message line was shown already.
            if (source.role === 'resume' || source.resumed === true)
                return <div className='bt-event'>{t('Picked up its work after a restart')}</div>;
            if (source.role === 'retry' || source.retried === true)
                return <div className='bt-event'>{t('Asked to make the tool call it wrote as text')}</div>;
            const run = relayed && turn !== undefined ? commRunOf(order.split(',').filter(Boolean).map(Number), Object.fromEntries(peers.split(',').filter(Boolean).map(pair => [Number(pair.slice(0, pair.indexOf(':'))), pair.slice(pair.indexOf(':') + 1)] as const)), turn, hiddenTurns) : null;
            if (run === 'folded')
                return null;
            const sender = (source.senderSessionId === undefined ? undefined : roster.byId[source.senderSessionId]) ?? { id: source.senderSessionId ?? '', name: source.senderName ?? t('a Bot'), color: 'gray' };
            const count = run?.count ?? (isHiddenTurn(roster, sessionId, turn) ? 2 : 1);
            // Peers may be named by any part of their chat, so they are matched by Bot.
            const bots = [sender];
            for (const peer of (run?.peerIds ?? []).map(id => roster.byId[id]).filter((entry): entry is ChatBot => entry !== undefined)) {
                if (!bots.some(bot => bot.id === peer.id))
                    bots.push(peer);
            }
            return h(EventLine, {
                prefix: source.role === 'stopped' ? t('Stopped by') : count > 1 ? t('{count} messages with', { count }) : t('Message from'),
                bots,
                onOpen: bot => actions.openExchange(selfId, bot.id),
                whole: true,
            });
        }
        if (source.kind === 'schedule') {
            const prompts = reminderPrompts(contentText(data.content));
            return <div className='bt-event'>{prompts.length > 0 ? t('Scheduled task: {text}', { text: prompts.join(' · ').slice(0, 80) }) : t('Routine started')}</div>;
        }
        if (source.kind === 'user-question-reply' || source.kind === 'goal')
            return null;
        return <div className='bt-event'>{contentText(data.content).slice(0, 80) || t('Update')}</div>;
    }
}
function NewDivider() {
    return <div className='bt-new-sep' role='separator' aria-label={t('New messages')}><span>{t('New')}</span></div>;
}
export function TurnProcessCell({ node, sessionId, turnProcess, useRoster, useUi, useTurnClock, actions }: TurnProcessCellProps) {
    const open = turnProcess === undefined || !turnProcess.foldable || turnProcess.open;
    useEffect(() => {
        if (!open && turnProcess !== undefined)
            turnProcess.setOpen(true);
    }, [open, turnProcess]);
    const turn = node?.location?.turn?.turn ?? node?.data?.turn;
    const start = node?.location?.turn?.start?.time;
    const hidden = useRoster(roster => isHiddenTurn(roster, sessionId, turn));
    // Exchange turns hide their replies but still show their trigger chip, so their start
    // counts for separators too.
    useEffect(() => {
        actions.noteTurnTime(sessionId, turn, 'first', start);
    }, [sessionId, turn, start]);
    // The reply to a turn the user saw begin arrived while the user was away.
    const visit = useUi(state => state.visits?.[sessionId]);
    const fresh = useTurnClock((state) => {
        const own = turn === undefined ? undefined : state[sessionId]?.[turn];
        return !hidden && typeof visit?.seen === 'number' && own?.first !== undefined && own.first <= visit.seen
            && own.end !== undefined && own.end > visit.seen && own.end <= visit.entered;
    });
    return fresh ? h(NewDivider) : null;
}
export function Nothing() { return null; }
function nextTurnStart(turns: TurnTable, turn: number): number | undefined {
    let next: number | undefined;
    for (const key in turns) {
        const candidate = Number(key);
        if (candidate > turn && turns[key]?.first !== undefined && (next === undefined || candidate < next))
            next = candidate;
    }
    return next === undefined ? undefined : turns[next]?.first;
}
// The first turn the transcript shows: the earliest rendered start, with only hidden
// exchange turns before it. `firstTurns` lists the outline's first turns.
export function openingTurn(turns: TurnTable | undefined, firstTurns: string, hiddenTurns: readonly number[] | undefined): {
    turn: number;
    start: number;
} | null {
    if (!turns || !firstTurns)
        return null;
    const start = nextTurnStart(turns, -Infinity);
    if (start === undefined)
        return null;
    const turn = Number(Object.keys(turns).filter(key => turns[key]?.first === start)[0]);
    const listed = firstTurns.split(',').map(Number);
    const earlier = listed.filter(entry => entry < turn);
    return listed.includes(turn) && earlier.every(entry => hiddenTurns?.includes(entry)) ? { turn, start } : null;
}
// Began after the user last left the conversation and before this visit opened it.
export const unseenSince = (visit: Visit | undefined, time: number): boolean => typeof visit?.seen === 'number' && time > visit.seen && time <= visit.entered;
// An entry in DSH's own turn tail, after what other plugins put there (the cards of
// the files a turn delivered). The tail sits right before the next turn's first row,
// so the separator for a pause between turns renders here.
export function TurnTailCell({ turn: location, sessionId, useTurnClock, useUi, actions }: TurnTailCellProps) {
    const turn = location.turn;
    // DSH builds the tail from the turn's end, so it is there.
    const time = location.end.time;
    useEffect(() => { actions.noteTurnTime(sessionId, turn, 'end', time); }, [sessionId, turn, time]);
    const label = useTurnClock((state) => {
        const start = nextTurnStart(state[sessionId] ?? {}, turn);
        return start !== undefined && start - time >= SEPARATOR_GAP_MS ? clockLabel(start) : '';
    });
    // The unread divider sits before the first turn that began after the last visit;
    // turns that begin while the conversation is open were watched live.
    const visit = useUi(state => state.visits?.[sessionId]);
    const fresh = useTurnClock((state) => {
        if (typeof visit?.seen !== 'number' || time > visit.seen)
            return false;
        const start = nextTurnStart(state[sessionId] ?? {}, turn);
        return start !== undefined && start > visit.seen && start <= visit.entered;
    });
    // The cards of the files this turn delivered sit after its last message.
    const files = useTurnFiles(sessionId, turn);
    const cards = files !== null && files.length > 0 ? h(FileCards, { files, sessionId }) : null;
    if (!label && !fresh && !cards)
        return null;
    return <>{cards}{label ? <div className='bt-time-sep' role='separator'>{label}</div> : null}{fresh ? h(NewDivider) : null}</>;
}
// The calls ToolCell draws. A PTC program (`run_code`) dispatches the real tools as
// its sub-calls, so a call draws by its own name wherever it sits in the tree.
export const DRAWN = new Set(['message_bot', 'stop_bot', 'create_bot', 'update_bot', 'group_relay', 'create_group', 'update_group', 'delete_group', 'post_to_group', 'ask_user', 'request_secret', 'ask_user_question', 'show_view', 'read_group_chat', 'remember', 'forget']);
// Calls whose card a dock above the composer carries when the call is not drawn.
export const CARDS = new Set(['ask_user', 'request_secret', 'show_view']);
export interface ChatCall {
    name?: string;
    kind?: string;
    isError?: boolean;
    callId?: string;
    turn?: number;
    argsRaw?: string;
    call?: {
        name?: string;
        argsRaw?: string;
    };
    args?: {
        text?: (key: string) => string | undefined;
        value?: (key: string) => unknown;
    };
    content?: Parameters<typeof contentText>[0];
    subCalls?: readonly ChatCall[];
}
// The root and its sub-calls in dispatch order, each call once.
export function callTree(root: ChatCall): ChatCall[] {
    const calls: ChatCall[] = [];
    const seen = new Set<string | ChatCall>();
    const visit = (call: ChatCall): void => {
        const id = call.callId ?? call;
        if (seen.has(id))
            return;
        seen.add(id);
        calls.push(call);
        for (const child of call.subCalls ?? [])
            visit(child);
    };
    visit(root);
    return calls;
}
// The newest call that is not a result: what the program is doing now.
export const lastRunning = (calls: readonly ChatCall[]): ChatCall | undefined => {
    for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (call !== undefined && call.kind !== 'tool-result')
            return call;
    }
    return undefined;
};
