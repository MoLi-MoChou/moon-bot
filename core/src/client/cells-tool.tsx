import { createElement as h, Fragment, useEffect, useState } from 'react';
import { MarkdownText } from './dsh-primitives.tsx';
import { failureLabel } from './diagnostics.ts';
import { t } from './i18n.ts';
import { BotMark, toolState } from './mark.tsx';
import { PendingQuestion, SettledQuestion } from './questions.tsx';
import type { QuestionAnswer } from './questions.tsx';
import { contentText, isHiddenTurn, messageClock, clockLabel, toolArgs, toolName } from './text.ts';
import { SecretToolCell } from './secret-card.tsx';
import { WidgetCell } from './widget-cell.tsx';
import { heldCardKey } from './sources.ts';
import { GroupMessage, mdLabels, stackReplies } from './cells-bubbles.tsx';
import { EventLine, GroupEvent, Shimmer } from './cells-chat.tsx';
import type { CellActions, CellsUiState, ChatBot, ChatRoster, GroupReply, NodeLocation, StoreHook } from './cells-bubbles.tsx';
import { MemoryEvent, useLiveNote } from './cells-rows.tsx';
import { CARDS, DRAWN, callTree, lastRunning } from './cells-turns.tsx';
import type { ChatCall } from './cells-turns.tsx';
import { useShownCards, groupVerb } from './cells-tool-helpers.ts';
/** What a Bot busy elsewhere is doing: its running call, or just the tool's name. */
export interface WorkDoing {
    tool?: string | undefined;
    said?: string | undefined;
    note?: string | undefined;
    target?: string | undefined;
    switching?: boolean | undefined;
}
export interface WorkState {
    bots?: Readonly<Record<string, WorkDoing | undefined>> | undefined;
}
export type WorkHook = StoreHook<WorkState>;
/** What a running tool says in the activity row. */
export interface ToolActivity {
    label?: string | null | undefined;
    relay?: true | undefined;
    state: string;
}
/** One call of a turn's call tree: its name, arguments and result. */
export interface ToolNode {
    key?: string | number | undefined;
    data: {
        root: ChatCall;
    };
    location?: NodeLocation | undefined;
}
export interface ToolCellProps {
    node: ToolNode;
    sessionId: string;
    useRoster: StoreHook<ChatRoster>;
    useUi: StoreHook<CellsUiState>;
    useWork?: WorkHook | undefined;
    useHeldCards?: StoreHook<Record<string, Record<string, number> | undefined>> | undefined;
    actions: CellActions;
}
interface GroupRepliesProps {
    sessionId: string;
    callId?: string | undefined;
    done: boolean;
    content?: Parameters<typeof contentText>[0];
    roster: ChatRoster;
    actions: CellActions;
    useUi?: StoreHook<CellsUiState> | undefined;
    useWork?: WorkHook | undefined;
}
interface LiveReplies {
    replies: readonly GroupReply[];
    speaking: string | null;
}
interface CallEnv {
    sessionId: string;
    roster: ChatRoster;
    actions: CellActions;
    useUi?: StoreHook<CellsUiState> | undefined;
    useWork?: WorkHook | undefined;
    findBot: (nameOrId?: string | undefined) => ChatBot | undefined;
    heldCards?: Record<string, number> | undefined;
    turnKey?: string | undefined;
}
type ArgReader = (key: string) => string | undefined;
// Status phrases. A running tool names what it does; otherwise one
// phrase is drawn from the pool each time the activity changes.
export const PHRASES = {
    thinking: ['Mulling it over', 'Thinking about it', 'Weighing the options', 'Working out a plan', 'Sorting out the details'],
    working: ['Getting it done', 'On it', 'Busy with it', 'Moving ahead', 'Taking care of it', 'Making headway'],
};
const TOOL_PHRASES: readonly (readonly [
    RegExp,
    string
])[] = [
    [/web_?search|search_?web/i, 'Searching online'],
    [/fetch|browse|browser|web/i, 'Reading a page'],
    [/shell|bash|pwsh|powershell|exec|command|terminal/i, 'Running shell commands'],
    [/^(read|view|cat)\b|read_/i, 'Opening a file'],
    [/grep|glob|list_dir|^ls$|find|search/i, 'Looking through files'],
    [/write|edit|patch|apply|replace/i, 'Writing changes'],
    [/image|photo|draw/i, 'Working on an image'],
];
const GROUP_PHRASES: Readonly<Record<string, string | undefined>> = { create_group: 'Creating a group', update_group: 'Updating the group', delete_group: 'Deleting the group', post_to_group: 'Posting in the group' };
function toolActivity(name: string | undefined, arg: ArgReader, findBot: (nameOrId?: string | undefined) => ChatBot | undefined, self: ChatBot | undefined): ToolActivity | null {
    switch (name) {
        case 'ask_user': return null;
        case 'request_secret': return null;
        case 'list_secrets': return { label: t('Checking the keys'), state: 'searching' };
        case 'ask_user_question': return { label: t('Waiting for your answer'), state: 'alert' };
        case 'group_relay': return { relay: true, state: 'orbit' };
        case 'message_bot': {
            const target = findBot(arg('to'));
            return { label: target ? t('Asking {name}', { name: target.name }) : t('Asking another Bot'), state: 'sending' };
        }
        case 'stop_bot': {
            const target = findBot(arg('bot'));
            return { label: target ? t('Stopping {name}', { name: target.name }) : t('Stopping another Bot'), state: 'sending' };
        }
        case 'create_bot': return { label: t('Creating {name}', { name: arg('name') ?? t('a Bot') }), state: 'sending' };
        case 'update_bot': {
            const target = findBot(arg('name')) ?? findBot(arg('bot')) ?? (arg('bot') ? undefined : self);
            return { label: t('Updating {name}', { name: target?.name ?? t('a Bot') }), state: 'sending' };
        }
        case 'list_bots': return { label: t('Checking the team'), state: 'searching' };
        case 'read_group_chat': return { label: t('Reading {name}', { name: arg('group') ?? t('a group chat') }), state: 'searching' };
        case 'read_own_chat': return { label: t('Looking back through the chat'), state: 'searching' };
        case 'remember': return { label: t('Saving to memory'), state: 'working' };
        case 'forget': return { label: t('Updating memory'), state: 'working' };
        case 'recall': return { label: t('Checking memory'), state: 'searching' };
        default: {
            const group = name === undefined ? undefined : GROUP_PHRASES[name];
            if (group)
                return { label: t(group), state: 'sending' };
            const phrase = TOOL_PHRASES.find(([pattern]) => pattern.test(String(name)))?.[1];
            return { label: phrase ? t(phrase) : null, state: toolState(String(name)) };
        }
    }
}
// What a Bot busy elsewhere is doing: what it said in the step it is on, its running
// call's own description, else the kind of tool and what it works on. `doing` is a work
// entry, or just a tool name.
export function workPhrase(doing: string | WorkDoing | undefined): string {
    const { tool, said, note, target, switching } = typeof doing === 'string' ? { tool: doing } : doing ?? {};
    if (switching)
        return t('Moving to a fresh conversation');
    const own = (said || note)?.replace(/[\s.。…]+$/u, '');
    if (own)
        return own;
    if (!tool)
        return t('Thinking about it');
    const label = toolActivity(tool, () => undefined, () => undefined, undefined)?.label ?? t('On it');
    return target ? `${label} · ${target}` : label;
}
function GroupReplies({ sessionId, callId, done, content, roster, actions, useUi, useWork }: GroupRepliesProps) {
    const [live, setLive] = useState<LiveReplies>({ replies: [], speaking: null });
    useEffect(() => {
        if (done)
            return undefined;
        let stop = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let seen = '';
        const tick = async (): Promise<void> => {
            const result = await actions.roomProgress(sessionId);
            if (stop)
                return;
            const entry = (result ?? []).find(item => item.callId === callId) ?? (result ?? [])[0];
            const key = entry ? JSON.stringify([entry.replies, entry.speaking]) : '';
            if (entry && key !== seen) {
                seen = key;
                setLive({ replies: entry.replies ?? [], speaking: entry.speaking ?? null });
            }
            timer = setTimeout(tick, document.hidden ? 5000 : 1000);
        };
        void tick();
        return () => { stop = true; clearTimeout(timer); };
    }, [done, sessionId, callId]);
    let replies = live.replies;
    if (done) {
        try {
            replies = JSON.parse(contentText(content)).replies ?? [];
        }
        catch {
            replies = [];
        }
    }
    // Members speak one at a time, so only the current speaker is typing.
    const pending = done || !live.speaking ? [] : [live.speaking];
    const speaker = live.speaking === null ? undefined : live.speaking;
    const speakerTool = useWork?.(work => (speaker === undefined ? undefined : work.bots?.[speaker]?.tool)) ?? undefined;
    const speakerDoing = useWork?.(work => {
        const bot = speaker === undefined ? undefined : work.bots?.[speaker];
        return bot?.tool ? workPhrase(bot) : undefined;
    }) ?? undefined;
    if (replies.length === 0 && pending.length === 0)
        return null;
    const room = roster.roomsById[sessionId];
    return <div className='bt-group-replies'>{stackReplies(replies).map(({ reply, index, texts, time, duration }) => {
        const bot = roster.byId[reply.botId] ?? { id: reply.botId, name: reply.name, color: reply.color ?? 'gray' };
        if (reply.kind === 'user') {
            return <div key={`user-${index}`} className='bt-urow'><div className='bt-ububble'><MarkdownText text={reply.text} labels={mdLabels()} variant='compact' />{time !== undefined && Number.isFinite(time) ? <div className='bt-utime' title={clockLabel(time)}>{messageClock(time)}</div> : null}</div></div>;
        }
        if (reply.kind === 'failed') {
            return <div key={`${reply.botId}-${index}`} className='bt-event bt-event-error' role='status' title={[reply.code, reply.status, reply.text].filter(Boolean).join(' · ')}>{t('{name} could not answer: {reason}', { name: bot.name, reason: failureLabel(reply.code ?? t('Unknown error'), reply.text) })}</div>;
        }
        if (reply.kind === 'lookup') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'>{reply.text ? t('{name} looked up its own chat for “{text}”', { name: bot.name, text: reply.text }) : t('{name} looked up its own chat', { name: bot.name })}</div>;
        }
        if (reply.kind === 'missed') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'>{t("{name} didn't answer in time", { name: bot.name })}</div>;
        }
        if (reply.kind === 'resumed') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'>{t('{name} was cut off by a restart and picked its work back up', { name: bot.name })}</div>;
        }
        if (reply.kind === 'cut') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'>{t('{name} was cut off by a restart again and stopped', { name: bot.name })}</div>;
        }
        if (reply.kind === 'approval' || reply.kind === 'working') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'><button type='button' className='bt-event-whole' onClick={() => actions.showDetails(sessionId)}><BotMark bot={bot} size={16} /><span className='bt-event-name'>{t(reply.kind === 'working' ? '{name} started on it' : '{name} paused for your approval', { name: bot.name })}</span></button></div>;
        }
        if (reply.kind === 'stopped') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'>{t("You stopped {name}'s work", { name: bot.name })}</div>;
        }
        if (reply.kind === 'done') {
            return <div key={`${reply.botId}-${index}`} className='bt-event'>{t('{name} finished its work', { name: bot.name })}</div>;
        }
        return <GroupMessage key={`${reply.botId}-${index}`} bot={bot} texts={texts} room={room} roster={roster} actions={actions} msgKey={callId ? `${sessionId}:${callId}:${index}` : undefined} useUi={useUi} time={time} duration={duration} />;
    })}{pending.map((id) => {
        const bot = roster.byId[id];
        if (!bot)
            return null;
        return <div key={`pending-${id}`} className='bt-activity'><BotMark bot={bot} size={22} state={speakerTool ? toolState(speakerTool) : 'thinking'} /><Shimmer>{speakerDoing ? `${bot.name} · ${speakerDoing}…` : t('{name} is typing…', { name: bot.name })}</Shimmer></div>;
    })}</div>;
}
// Tells the docks which card calls the transcript draws, so a card shows in one place.
// A layout effect: an untouched dock drops its copy before the first paint.
function renderCall(call: ChatCall, { sessionId, roster, actions, useUi, useWork, findBot, heldCards, turnKey }: CallEnv) {
    const tool = toolName(call);
    const done = call.kind === 'tool-result';
    const { text: arg, value: argValue } = toolArgs(call);
    const self = roster.byId[sessionId];
    switch (tool) {
        case 'message_bot': {
            const target = findBot(arg('to')) ?? { name: arg('to') ?? '…', color: 'gray' };
            if (done && call.isError)
                return <div className='bt-event'>{t("Couldn't message {name}", { name: target.name })}</div>;
            return <EventLine prefix={t('Messaged')} bots={[target]} onOpen={bot => { if (bot.id)
                    actions.openExchange(self?.id ?? sessionId, bot.id); }} whole />;
        }
        case 'stop_bot': {
            const target = findBot(arg('bot')) ?? { name: arg('bot') ?? '…', color: 'gray' };
            if (done && call.isError)
                return <div className='bt-event'>{t("Couldn't stop {name}", { name: target.name })}</div>;
            return <EventLine prefix={t('Stopped')} bots={[target]} onOpen={bot => { if (bot.id)
                    actions.openExchange(self?.id ?? sessionId, bot.id); }} whole />;
        }
        case 'create_bot': {
            const created = findBot(arg('name'));
            if (!done || created === undefined)
                return null;
            return <EventLine prefix={t('Created')} bots={[created]} onOpen={bot => actions.openSession(bot.id)} />;
        }
        case 'update_bot': {
            const target = findBot(arg('name')) ?? findBot(arg('bot')) ?? (arg('bot') ? undefined : self);
            return done && target ? <EventLine prefix={t('Updated')} bots={[target]} onOpen={bot => actions.openSession(bot.id)} /> : null;
        }
        case 'group_relay':
            return <GroupReplies sessionId={sessionId} callId={call.callId} done={done} content={call.content} roster={roster} actions={actions} useUi={useUi} useWork={useWork} />;
        case 'create_group':
        case 'update_group':
        case 'delete_group':
        case 'post_to_group': {
            const verbs = groupVerb(tool);
            if (!done)
                return null;
            // Tool results quote the group's name; anything else is a refusal.
            const result = contentText(call.content);
            const named = /^(Created group|Updated|Nothing changed in|Deleted|Posted in) "([^"]+)"/.exec(result);
            if (call.isError || !named)
                return <div className='bt-event' title={result}>{t(verbs[1])}</div>;
            const name = named[2];
            const room = roster.rooms.find(entry => entry.name === name);
            return <GroupEvent prefix={t(verbs[0])} room={tool === 'delete_group' ? undefined : room} name={name} roster={roster} actions={actions} />;
        }
        case 'ask_user': {
            const question = roster.questions?.[sessionId];
            // Answered or closed: the card leaves no gap where it was.
            if (!question || question.callId !== call.callId)
                return <span className='bt-q-gone' hidden/>;
            if ((heldCards?.[heldCardKey('question', question.id)] ?? 0) > 0)
                return null;
            return <PendingQuestion key={JSON.stringify([sessionId, question.id])} sessionId={sessionId} question={question} actions={actions} inline />;
        }
        case 'show_view':
            // The cell's arguments reader forwards the tool's accessor unchanged, as the JS did;
            // its declared type says a key never misses, which the host's arguments do not promise.
            return <WidgetCell sessionId={sessionId} callId={call.callId ?? ''} args={{ text: arg, value: argValue } as Parameters<typeof WidgetCell>[0]['args']} done={done} isError={call.isError ?? false} roster={roster} actions={actions} heldCards={heldCards} />;
        case 'request_secret':
            return <SecretToolCell sessionId={sessionId} callId={call.callId ?? ''} name={arg('name')} done={done} content={call.content} roster={roster} actions={actions} heldCards={heldCards} />;
        case 'ask_user_question': {
            if (!done)
                return null;
            let parsed: {
                answers?: readonly QuestionAnswer[];
            } | null = null;
            try {
                parsed = JSON.parse(contentText(call.content));
            }
            catch {
                parsed = null;
            }
            const answer = parsed?.answers?.[0];
            const questions = argValue('questions');
            const question = Array.isArray(questions) ? questions[0] : undefined;
            if (!answer)
                return null;
            return <div className='bt-q-inline'><SettledQuestion question={question} answer={answer} /></div>;
        }
        case 'read_group_chat': {
            if (!done)
                return null;
            const room = roster.rooms.find(entry => entry.name === arg('group'));
            return room ? <GroupEvent prefix={t('Read')} room={room} roster={roster} actions={actions} /> : null;
        }
        case 'remember':
        case 'forget':
            return done && !call.isError ? <MemoryEvent sessionId={sessionId} scope={arg('scope')} result={contentText(call.content)} roster={roster} actions={actions} findBot={findBot} turnKey={turnKey} callId={call.callId} /> : null;
        default:
            return null;
    }
}
export function ToolCell({ node, sessionId, useRoster, useUi, useWork, useHeldCards, actions }: ToolCellProps) {
    const roster = useRoster(value => value);
    const heldCards = useHeldCards?.(state => state[sessionId]);
    const root = node.data.root;
    const turn = node.location?.turn?.turn ?? root.turn;
    const hidden = isHiddenTurn(roster, sessionId, turn);
    const findBot = (nameOrId?: string): ChatBot | undefined => roster.byId[nameOrId ?? ''] ?? roster.bots.find(bot => bot.name.toLowerCase() === String(nameOrId ?? '').toLowerCase());
    const calls = hidden ? [] : callTree(root);
    const drawn = calls.filter((call) => { const name = toolName(call); return name !== undefined && DRAWN.has(name); });
    // The newest call still running names the work, so a program reads as the tool it is in.
    const running = root.kind === 'tool-result' ? undefined : lastRunning(calls);
    const note = running ? toolActivity(toolName(running), toolArgs(running).text, findBot, roster.byId[sessionId]) : null;
    // A running tool shows only as the activity row's phrase.
    useLiveNote(actions, sessionId, `tool:${root.callId ?? node.key}`, note);
    useShownCards(actions, sessionId, drawn.flatMap((call) => { const name = toolName(call); return name !== undefined && CARDS.has(name) && call.callId ? [call.callId] : []; }));
    if (drawn.length === 0)
        return null;
    const env: CallEnv = { sessionId, roster, actions, useUi, useWork, findBot, heldCards, turnKey: turn === undefined ? undefined : `${sessionId}:${turn}` };
    return <>{drawn.map((call) => <>{renderCall(call, env)}</>)}</>;
}
