import { Fragment, createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { call } from './api.ts';
import { MemoryIcon } from './icons.tsx';
import { t } from './i18n.ts';
import { elapsedLabel, isHiddenTurn, relayPart, relaysBefore } from './text.ts';
import type { RelayContext } from './text.ts';
import { turnReasoning, thinkingStep } from './turn-reasoning.ts';
import { FOLD_HUGE } from './fold.tsx';
import { WorkLine } from './work-process.tsx';
import { Bubbles } from './cells-bubbles.tsx';
import type { CellActions, CellsUiState, ChatBot, ChatRoster, LiveNote, NodeLocation, StoreHook, TurnInfo } from './cells-bubbles.tsx';
import { Elapsed, EventLine } from './cells-chat.tsx';
/** A relay line as the host also names it: its event seq and the sender's name. */
type RelaySourceEntry = NonNullable<RelayContext['source']> & {
    senderName?: string | undefined;
};
interface RelayEntry {
    seq?: number;
    source?: RelaySourceEntry | null | undefined;
}
/** One block of a step: its kind, and the text it carries. */
interface StepBlock {
    kind?: string;
    text: string;
}
/** A step of a Turn as the transcript hands it over. */
export interface StepData {
    turn: number;
    status?: string;
    blocks: StepBlock[];
    seq?: number;
    time?: number;
    finalNode?: {
        seq?: number;
    };
}
/** A transcript node of a step, with the turn it sits in. */
export interface CellStepNode {
    key?: string | number | undefined;
    data: StepData;
    location?: NodeLocation | undefined;
}
/** The turn's own tail entry: the closing step the host reports. */
export interface TurnTailData {
    closing?: {
        finalNode: {
            seq?: number | undefined;
        };
    } | undefined;
}
export type TurnDataHook = (name: string) => TurnTailData | undefined;
/** Resolves the files a finished turn mentioned, from the step that closes it. */
export type FileMentions = (args: {
    turn: TurnInfo;
    seq: number;
    openFile: unknown;
}) => unknown;
interface ThinkingMsArgs {
    sessionId: string;
    turn: number;
    settledSteps: number;
    skip: boolean;
}
/** One row's scroll and open state, kept per turn so the row can move between steps. */
interface RowView {
    open?: boolean | undefined;
    atEnd?: boolean | undefined;
    top?: number | undefined;
}
export interface ThinkingRowProps {
    text: string;
    live: boolean;
    at?: number | undefined;
    ms?: number | undefined;
    viewKey?: string | undefined;
}
export interface AssistantCellProps {
    node: CellStepNode;
    groupPart?: string | undefined;
    sessionId: string;
    openFile: unknown;
    fileMentions?: FileMentions | undefined;
    useTurnData?: TurnDataHook | undefined;
    useRoster: StoreHook<ChatRoster>;
    useUi: StoreHook<CellsUiState>;
    useTurnSteps: (turn: string) => readonly StepData[];
    useTurnTools?: ((turn: string) => Parameters<typeof WorkLine>[0]['tools']) | undefined;
    useTurnContext: (turn: string) => readonly RelayContext[] | undefined;
    actions: CellActions;
}
interface MemoryEventProps {
    sessionId: string;
    scope?: string | undefined;
    result: string;
    roster: ChatRoster;
    actions: CellActions;
    findBot: (nameOrId?: string | undefined) => ChatBot | undefined;
    turnKey?: string | undefined;
    callId?: string | undefined;
}
// A Turn's settled thinking time, fetched per count of settled steps: while a turn
// runs each new settled step refetches; scrolling back to a loaded turn reuses it.
const thinkingTimes = new Map<string, number | undefined>();
function useThinkingMs({ sessionId, turn, settledSteps, skip }: ThinkingMsArgs): number | undefined {
    const key = `${sessionId}:${turn}:${settledSteps}`;
    const [ms, setMs] = useState<number | undefined>(() => thinkingTimes.get(key));
    useEffect(() => {
        if (skip || thinkingTimes.has(key)) {
            setMs(thinkingTimes.get(key));
            return undefined;
        }
        const control = new AbortController();
        call<{
            ms?: number | undefined;
        }>('thinking', { sessionId, turn }, control.signal)
            .then(value => { thinkingTimes.set(key, value?.ms); setMs(value?.ms); })
            .catch(() => { });
        return () => control.abort();
    }, [key, skip]);
    return ms;
}
// The row starts closed. Few readers go through a whole chain of thought, so when opened
// it shows the last lines and the box scrolls for the rest. It stays at the end as later
// steps add reasoning, unless the reader has scrolled up. While a step of the turn is
// thinking the row shows immediately and ticks (`at` backs the live clock so it counts
// the settled steps too); settled, it shows the turn's exact thinking time if known.
// A live turn's row moves to the step that reasons now, so whether the reader opened it
// and where they scrolled is kept per turn (`viewKey`), not per row.
const rowViews = new Map<string, RowView>();
export function ThinkingRow({ text, live, at, ms, viewKey }: ThinkingRowProps) {
    const box = useRef<HTMLDivElement | null>(null);
    const view = useRef<RowView | undefined>(viewKey === undefined ? undefined : rowViews.get(viewKey));
    const atEnd = useRef(view.current?.atEnd ?? true);
    const [open, setOpen] = useState(view.current?.open ?? false);
    const [fade, setFade] = useState<string | undefined>(undefined);
    const remember = (patch: RowView): void => { if (viewKey !== undefined)
        rowViews.set(viewKey, { ...rowViews.get(viewKey), ...patch }); };
    const measure = (): void => {
        const el = box.current;
        if (el === null)
            return;
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
        remember({ atEnd: atEnd.current, top: el.scrollTop });
        const above = el.scrollTop > 0;
        setFade(above && !atEnd.current ? 'both' : above ? 'top' : !atEnd.current ? 'bottom' : undefined);
    };
    const toggle = (event: SyntheticEvent<HTMLDetailsElement>): void => {
        const next = event.currentTarget.open;
        if (next)
            atEnd.current = true;
        remember({ open: next });
        setOpen(next);
    };
    useLayoutEffect(() => {
        if (!open)
            return;
        const el = box.current;
        if (el === null)
            return;
        const restore = view.current;
        view.current = undefined;
        if (atEnd.current)
            el.scrollTop = el.scrollHeight;
        else if (restore?.top !== undefined)
            el.scrollTop = restore.top;
        measure();
    }, [text, open]);
    const title = live ? t('Thinking') : t('Thought it through');
    return <details className='bt-think' open={open} onToggle={toggle}><summary>{title}{live && at !== undefined ? <Elapsed at={at} className='bt-think-time' /> : null}{!live && ms !== undefined ? <span className='bt-think-time'>{`· ${elapsedLabel(Math.max(1000, ms))}`}</span> : null}</summary><div ref={box} className='bt-think-text' role='region' aria-label={title} tabIndex={0} data-fade={fade} onScroll={measure}>{text}</div></details>;
}
// The files a finished turn changed or delivered, linked from inline code in its
// reply as in the host's own chat. the host resolves them for the step that closes the turn.
function useFileMentions({ node, openFile, fileMentions, useTurnData }: {
    node: CellStepNode;
    openFile: unknown;
    fileMentions?: FileMentions | undefined;
    useTurnData?: TurnDataHook | undefined;
}): unknown {
    const tail = useTurnData?.('turn-tail');
    const location = node.location;
    const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined;
    const seq = node.data.finalNode?.seq;
    return useMemo(() => {
        if (typeof fileMentions !== 'function' || turn?.status !== 'closed' || seq === undefined)
            return undefined;
        return tail?.closing?.finalNode.seq === seq ? fileMentions({ turn, seq, openFile }) : undefined;
    }, [fileMentions, openFile, seq, tail, turn]);
}
export function AssistantCell({ node, groupPart, sessionId, openFile, fileMentions, useTurnData, useRoster, useUi, useTurnSteps, useTurnTools, useTurnContext, actions }: AssistantCellProps) {
    const roster = useRoster(value => value);
    const data = node.data;
    const steps = useTurnSteps(String(data.turn));
    const contexts = useTurnContext(String(data.turn));
    const tools = useTurnTools?.(String(data.turn)) ?? [];
    const mentions = useFileMentions({ node, openFile, fileMentions, useTurnData });
    const hidden = Boolean(roster.roomsById[sessionId]) || isHiddenTurn(roster, sessionId, data.turn);
    const texts = groupPart === 'reasoning' ? [] : data.blocks.filter(block => block.kind === 'text' && block.text.trim() !== '').map(block => block.text);
    const running = data.status === 'running';
    const members: readonly StepData[] = steps.length ? steps : [data];
    const reasoning = groupPart === 'response' ? '' : turnReasoning(steps, data);
    // A live step of the same Turn keeps the row ticking even when it sits on an
    // earlier step's cell.
    const thinking = groupPart === 'response' ? undefined : thinkingStep(members);
    const ms = useThinkingMs({ sessionId, turn: data.turn, settledSteps: members.filter(step => step.status !== 'running').length, skip: hidden || reasoning === '' });
    // A streaming reply stands in for the activity row. Moon Bot folds the reasoning away,
    // so live reasoning only tells the row to say the Bot is thinking.
    useLiveNote(actions, sessionId, `text:${node.key ?? data.seq}`, !hidden && running && texts.length > 0 ? { text: true } : null);
    useLiveNote(actions, sessionId, `think:${node.key ?? data.seq}`, !hidden && thinking !== undefined && reasoning !== '' ? { thinking: true } : null);
    if (hidden)
        return null;
    // A relay spliced mid-turn is a 'context' node, hidden from the chat flow on
    // the host; the step that answers it shows the event line where it was read,
    // once, in the step's first cell.
    const relays: RelayEntry[] = relayPart(data, groupPart) ? relaysBefore(contexts, steps, data) : [];
    // Moon Bot: one work line on the turn's last step, once the turn has settled.
    const turnInfo = node.location?.turn;
    const lastStep = members[members.length - 1];
    const settled = !running && members.every(step => step.status !== 'running') && (turnInfo?.status === undefined || turnInfo.status === 'closed');
    const tail = useTurnData?.('turn-tail');
    const closingSeq = tail?.closing?.finalNode?.seq;
    const workHere = settled && groupPart !== 'reasoning' && (closingSeq !== undefined ? data.finalNode?.seq === closingSeq : lastStep === data);
    const workMs = typeof turnInfo?.start?.time === 'number' && typeof turnInfo?.end?.time === 'number' ? turnInfo.end.time - turnInfo.start.time : ms;
    if (texts.length === 0 && relays.length === 0 && !workHere)
        return null;
    const selfId = roster.byId[sessionId]?.id ?? sessionId;
    return <>{relays.map(relay => {
        const source = relay.source ?? {};
        const sender = (source.senderSessionId === undefined ? undefined : roster.byId[source.senderSessionId]) ?? { id: source.senderSessionId ?? '', name: source.senderName ?? t('a Bot'), color: 'gray' };
        return <EventLine key={relay.seq} prefix={source.role === 'stopped' ? t('Stopped by') : source.role === 'reply' ? t('Reply from') : t('Message from')} bots={[sender]} onOpen={() => { if (sender.id)
                actions.openExchange(selfId, sender.id); }} whole />;
    })}{workHere ? <WorkLine steps={members} tools={tools} ms={workMs} sessionId={sessionId} turn={data.turn} /> : null}{texts.length ? <Bubbles texts={texts} roster={roster} selfId={selfId} actions={actions} streaming={running} sessionId={sessionId} msgKey={`${sessionId}:${data.turn}:${node.key ?? data.seq ?? ''}`} useUi={useUi} mentions={mentions} fold={FOLD_HUGE} /> : null}</>;
}
// A change remember or forget made, which opens the memory it changed. Refusals and
// entries already saved changed nothing and show no line.
// Several changes to one memory in a turn show as one line: the first call keeps it.
const memoryLines = new Map<string, Map<string, string | undefined>>();
export const forgetMemoryLines = (): void => { memoryLines.clear(); };
const firstMemoryLine = (turnKey: string | undefined, target: string, callId: string | undefined): boolean => {
    if (turnKey === undefined || callId === undefined)
        return true;
    let lines = memoryLines.get(turnKey);
    if (!lines) {
        if (memoryLines.size > 500) {
            const oldest = memoryLines.keys().next().value;
            if (oldest !== undefined)
                memoryLines.delete(oldest);
        }
        memoryLines.set(turnKey, lines = new Map<string, string>());
    }
    if (!lines.has(target))
        lines.set(target, callId);
    return lines.get(target) === callId;
};
export function MemoryEvent({ sessionId, scope, result, roster, actions, findBot, turnKey, callId }: MemoryEventProps) {
    if (!/^(Saved to|Updated in|Removed from) /.test(result))
        return null;
    const self = roster.byId[sessionId];
    const team = /^(team|团队|共享)$/i.test(String(scope ?? '').trim());
    const other = team || !scope ? undefined : findBot(scope);
    const target = other && other.id !== self?.id ? other : self;
    if (!target)
        return null;
    if (!firstMemoryLine(turnKey, team ? 'team' : target.id, callId))
        return null;
    const label = team ? t('Team memory updated') : target === self ? t('Memory updated') : t("Updated {name}'s memory", { name: target.name });
    return <div className='bt-event'><button type='button' title={result} onClick={() => actions.openMemory(target.id)}><MemoryIcon />{label}</button></div>;
}
// Transcript rows report what is in flight to the one activity row at the tail.
export function useLiveNote(actions: CellActions, sessionId: string, id: string, entry: LiveNote | null): void {
    const key = entry ? JSON.stringify(entry) : '';
    useEffect(() => {
        if (!key)
            return undefined;
        actions.noteLive(sessionId, id, JSON.parse(key));
        return () => actions.noteLive(sessionId, id, null);
    }, [sessionId, id, key]);
}
