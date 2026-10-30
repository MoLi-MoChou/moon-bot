// Sidebar Bot / room / agent rows.
import { STORAGE } from './storage.ts';
import { createElement as h, useEffect, useLayoutEffect, useRef } from 'react';
import { FishLogo } from './primitives.tsx';
import { isMainOf } from './sources.ts';
import { currentPart, previewOf, relativeShort } from './text.ts';
import { PlusIcon, PinMarkIcon } from './icons.tsx';
import { botState, BotAvatar, RoomAvatar } from './mark.tsx';
import { Shimmer, workPhrase } from './cells.ts';
import { reducedMotion, SPRING_ROW_GLIDE } from './motion.tsx';
import { t } from './i18n.ts';
import type { ReactNode, RefObject } from 'react';
import type { TSidebarActions, TSidebarAgent, TSidebarBot, TSidebarDoing, TSidebarDoingRow, TSidebarEntry, TSidebarHook, TSidebarRoom, TSidebarRoster, TSidebarRowProps, TSidebarWaits, TSidebarWork, } from './sidebar-types.js';
export function useMarkedUnread(id: string, active: boolean, marked: boolean | undefined, actions: Pick<TSidebarActions, 'clearUnread'>): void {
    useEffect(() => {
        if (active && marked)
            actions.clearUnread(id);
    }, [active, marked]);
}
export const PinMark = () => <span className='bt-pin' aria-hidden><PinMarkIcon /></span>;
// Whether an approval waits for the user: for a Bot, in any of its Sessions; for a group,
// from any of its members there.
export const useApproval = (useWork: TSidebarHook<TSidebarWork> | undefined, match: (entry: {
    readonly botId?: string | undefined;
    readonly roomId?: string | undefined;
}) => boolean): boolean => (useWork ? useWork(work => (work.approvals ?? []).some(match)) : false);
// Work running in group Sessions, as "botId|tool" keys so a row redraws only when it
// changes: the groups one Bot works in, or the members at work in one group.
// Picked as text, so a row redraws only when what it shows changes.
export const useGroupWork = (useWork: TSidebarHook<TSidebarWork> | undefined, pick: (rooms: Record<string, readonly TSidebarDoing[]>) => unknown): string => (useWork ? useWork(work => JSON.stringify(pick(work.rooms ?? {}))) : '[]');
export const workKeys = <T,>(text: string): T => JSON.parse(text) as T;
export const doingOf = ({ tool, said, note, target, switching }: TSidebarDoing): TSidebarDoingRow => ({ tool, said, note, target, switching });
/** The Bot a room row leads with, and its working line; an idle room has neither. */
export const roomLead = (members: readonly TSidebarDoingRow[], roster: TSidebarRoster): { readonly lead?: TSidebarDoingRow, readonly first?: { readonly name: string }, readonly line: ReactNode | null } => {
    const lead = members[0];
    const first = lead?.id === undefined ? undefined : roster.byId[lead.id];
    return { ...(lead === undefined ? {} : { lead }), ...(first === undefined ? {} : { first }), line: lead === undefined || first === undefined ? null : workLine(first.name, lead, members.length - 1) };
};
export const workLine = (lead: string, doing: TSidebarDoingRow, more: number): ReactNode => <Shimmer>{`${lead} · ${workPhrase(doing)}…${more > 0 ? ` +${more}` : ''}`}</Shimmer>;
// The Bots and groups a Bot waits for (handoffs.ts), by the names they have now.
export const waitingFor = (roster: TSidebarRoster, waits: TSidebarWaits | null): string => {
    const names = [...(waits?.bots ?? []).map(id => roster.byId[id]?.name), ...(waits?.rooms ?? []).map(id => roster.roomsById[id]?.name)].filter(Boolean);
    return names.length === 0 ? '' : t('Waiting for {names}', { names: names.join(t(' and ')) });
};
export function BotRow({ bot, roster, actions, useSessions, useSessionStatus, useSessionRetainInfo, useActivity, useWork, wide, marked }: TSidebarRowProps & {
    readonly bot: TSidebarBot;
    readonly marked: boolean | undefined;
}) {
    const id = bot.id;
    const part = currentPart(bot);
    const preview = useSessions(list => previewOf(list as never, part, roster.exchangeTurns[part]));
    const running = useSessionStatus(map => map.get(part)?.running === true);
    const active = useSessionRetainInfo(part, info => (info?.retainedBy?.mainView ?? 0) > 0);
    const unread = useSessionStatus(map => map.get(part)?.completionUnread === true || map.get(part)?.pendingInteraction !== undefined) || (marked === true && !active);
    useMarkedUnread(id, active, marked, actions);
    const main = isMainOf(roster as never, id);
    const tile = roster.mainBotId === id;
    const approval = useApproval(useWork, entry => entry.botId === id);
    const alert = roster.questions?.[part] !== undefined || approval;
    const doing = useActivity(map => map[id]);
    // Work in a group runs in a Session of its own, so the Bot's chat stays idle meanwhile.
    const groups = workKeys<TSidebarDoingRow[]>(useGroupWork(useWork, rooms => Object.entries(rooms).flatMap(([roomId, entries]) => entries.filter(entry => entry.botId === id).map(entry => ({ id: roomId, ...doingOf(entry) })))));
    const away = !running && groups.length > 0;
    const state = botState(running || away, doing, alert);
    const lead = groups[0] as TSidebarDoingRow;
    const awayLine = away ? workLine((lead.id === undefined ? undefined : roster.roomsById[lead.id]?.name) ?? t('a group chat'), lead, groups.length - 1) : null;
    const waits = workKeys<TSidebarWaits | null>(useWork ? useWork(work => JSON.stringify(work.waiting?.[id] ?? null)) : 'null');
    const waitsFor = state === 'waiting' ? waitingFor(roster, waits) : '';
    if (bot.hidden && !active && !main)
        return null;
    const onContextMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        actions.openMenu({ kind: 'bot', id, x: event.clientX, y: event.clientY });
    };
    const pinned = bot.pinned === true && !tile;
    const label = [bot.name, main ? t('Main Bot') : '', pinned ? t('Pinned') : '', running || away ? t('Working') : '', waitsFor, approval ? t('Waiting for your approval') : alert ? t('Waiting for your answer') : '', unread ? t('Unread activity') : ''].filter(Boolean).join(', ');
    if (tile && wide) {
        return <div className='bt-tile-wrap'><button type='button' className={running || away ? 'bt-tile bt-busy' : 'bt-tile'} aria-label={label} aria-current={active ? 'page' : undefined} data-bot-id={id} title={preview || bot.name} onClick={() => actions.openSession(id)} onContextMenu={onContextMenu}><BotAvatar bot={bot} size={60} state={state} main /><span className='bt-tile-name'>{bot.name}</span>{running || away
            ? <span className='bt-tile-busy' aria-hidden><span className='bt-dots'><i /><i /><i /></span>{t('Working')}</span> : bot.role ? <span className='bt-chip bt-tile-role'>{bot.role}</span> : null}</button></div>;
    }
    return <button type='button' className={running || away ? 'bt-row bt-busy' : 'bt-row'} aria-label={label} aria-current={active ? 'page' : undefined} data-bot-id={id} title={wide ? undefined : bot.name} onClick={() => actions.openSession(id)} onContextMenu={onContextMenu}><BotAvatar bot={bot} size={36} state={state} main={main} />{pinned && !wide ? <PinMark /> : null}{wide ? <span className='bt-row-body'><span className='bt-row-name'><span className='bt-row-title'>{bot.name}</span>{pinned ? <PinMark /> : null}</span>{awayLine ? <span className='bt-row-preview'>{awayLine}</span> : running ? <span className='bt-row-preview bt-row-busy'><span className='bt-dots' aria-hidden><i /><i /><i /></span>{t('Working')}</span> : waitsFor ? <span className='bt-row-preview'>{waitsFor}</span> : preview ? <span className='bt-row-preview'>{preview}</span> : null}</span> : null}{wide && unread && !active ? <span className='bt-unread' aria-hidden/> : null}</button>;
}
export function RoomRow({ room, roster, actions, useSessions, useSessionStatus, useSessionRetainInfo, useWork, wide, marked }: Omit<TSidebarRowProps, 'useUi' | 'useActivity'> & {
    readonly room: TSidebarRoom;
    readonly marked: boolean | undefined;
}) {
    const id = room.id;
    const fallback = useSessions(list => previewOf(list as never, id));
    const preview = room.preview?.replace(/\s+/g, ' ').trim() || fallback;
    const active = useSessionRetainInfo(id, info => (info?.retainedBy?.mainView ?? 0) > 0);
    const unread = useSessionStatus(map => map.get(id)?.completionUnread === true) || (marked === true && !active);
    useMarkedUnread(id, active, marked, actions);
    const approval = useApproval(useWork, entry => entry.roomId === id);
    const members = workKeys<TSidebarDoingRow[]>(useGroupWork(useWork, rooms => (rooms[id] ?? []).map(entry => ({ id: entry.botId, ...doingOf(entry) }))));
    // A room with nobody working has no members: the row still draws, just without a line.
    const working = roomLead(members, roster);
    const workingLine = working.line;
    if (room.hidden && !active)
        return null;
    const pinned = room.pinned === true;
    const label = [room.name, pinned ? t('Pinned') : '', members.length > 0 ? t('Working') : '', approval ? t('Waiting for your approval') : ''].filter(Boolean).join(', ');
    return <button type='button' className={members.length > 0 ? 'bt-row bt-busy' : 'bt-row'} aria-label={label} aria-current={active ? 'page' : undefined} data-room-id={id} onClick={() => actions.openSession(id)} onContextMenu={(event) => { event.preventDefault(); actions.openMenu({ kind: 'room', id, x: event.clientX, y: event.clientY }); }}><RoomAvatar room={room} roster={roster} size={36} />{pinned && !wide ? <PinMark /> : null}{wide ? <span className='bt-row-body'><span className='bt-row-name'><span className='bt-row-title'>{room.name}</span>{pinned ? <PinMark /> : null}</span>{workingLine ? <span className='bt-row-preview'>{workingLine}</span> : preview ? <span className='bt-row-preview'>{preview}</span> : null}</span> : null}{wide && approval && !active ? <span className='bt-unread bt-unread-wait' aria-hidden/> : wide && unread && !active ? <span className='bt-unread' aria-hidden/> : null}</button>;
}
// One expanded Agent Session row: title, relative stamp, rename field, and a
// context menu for rename/archive.
/** One Session of the Agent, as its row draws it. */
export interface AgentSessionView {
    readonly id: string;
    readonly title: string;
    readonly at: number;
    readonly active: boolean;
    readonly running?: boolean | undefined;
    readonly unread?: boolean | undefined;
}
export function AgentSessionRow({ session, agent, actions, renaming, index }: {
    readonly session: AgentSessionView;
    readonly agent: TSidebarAgent;
    readonly actions: TSidebarActions;
    readonly renaming: boolean;
    readonly index: number;
}) {
    const input = useRef<HTMLInputElement | null>(null);
    useLayoutEffect(() => {
        if (!renaming)
            return;
        input.current?.focus();
        input.current?.select();
    }, [renaming]);
    if (renaming) {
        const commit = (keep: boolean): void => {
            const value = input.current?.value ?? '';
            if (!keep || value.trim() === '' || value.trim() === session.title) {
                actions.endAgentRename();
                return;
            }
            // The editor closes only after the rename landed; a failure keeps it open.
            void (async () => {
                try {
                    await actions.renameAgentSession(agent.id, session.id, value);
                    actions.endAgentRename();
                }
                catch (error) {
                    actions.reportError(error, 'agent-rename');
                }
            })();
        };
        return <div className='bt-agent-sub-row bt-agent-edit' style={{ '--i': index }}><input ref={input} defaultValue={session.title} aria-label={t('Rename')} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing)
                return;
            if (event.key === 'Enter')
                commit(true);
            else if (event.key === 'Escape')
                commit(false);
        }} onBlur={() => commit(true)}/></div>;
    }
    return <button type='button' className='bt-agent-sub-row' aria-current={session.active ? 'page' : undefined} style={{ '--i': index }} onClick={() => actions.openAgentSession(session.id)} onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.openMenu({ kind: 'agent-session', id: session.id, agentId: agent.id, x: event.clientX, y: event.clientY });
    }}><span className='bt-agent-sub-title'>{session.title}</span><span className='bt-agent-sub-time'>{session.at > 0 ? relativeShort(session.at) : ''}</span></button>;
}
// The Agent row: a plain session Session list lives in the Bot workspace, so it
// sits among the Bots with the harness's own whale mark.
export function AgentRow({ agent, actions, useSessions, useSessionStatus, useUi, wide, marked }: Omit<TSidebarRowProps, 'roster' | 'useSessionRetainInfo' | 'useActivity' | 'useWork'> & {
    readonly agent: TSidebarAgent;
    readonly marked: boolean | undefined;
}) {
    const info = useSessions(list => JSON.stringify(agent.sessions.map((id): AgentSessionView => {
        const row = list.byId[id];
        return {
            id,
            // A blank Session's title is the workspace folder name; show the label instead.
            title: row?.blank === true ? '' : (row?.displayTitle ?? row?.title ?? ''),
            at: row?.updatedAt ?? 0,
            running: row?.running === true,
            active: (row?.retainedBy?.mainView ?? 0) > 0,
        };
    }).sort((a, b) => b.at - a.at)));
    const statusInfo = useSessionStatus(map => JSON.stringify(agent.sessions.map(id => ({
        id, running: map.get(id)?.running === true, unread: map.get(id)?.completionUnread === true,
    }))));
    const statuses = Object.fromEntries((JSON.parse(statusInfo) as {
        id: string;
        running: boolean;
        unread: boolean;
    }[]).map(entry => [entry.id, entry])) as Record<string, {
        running: boolean;
        unread: boolean;
    }>;
    const sessions = (JSON.parse(info) as AgentSessionView[]).map(session => ({
        ...session,
        running: statuses[session.id]?.running ?? session.running,
        unread: statuses[session.id]?.unread ?? false,
        title: session.title === '' ? t('New session') : session.title,
    }));
    const renaming = useUi(value => value.renameAgent);
    const active = sessions.some(session => session.active);
    const running = sessions.some(session => session.running);
    const unread = sessions.some(session => session.unread === true) || (marked === true && !active);
    useMarkedUnread(agent.id, active, marked, actions);
    const preview = sessions[0]?.title ?? t('New session');
    const label = ['Agent', running ? t('Working') : '', unread ? t('Unread activity') : ''].filter(Boolean).join(', ');
    const open = active && wide;
    return <div className='bt-agent'><button type='button' className={running ? 'bt-row bt-busy' : 'bt-row'} aria-label={label} aria-current={active ? 'page' : undefined} data-agent-id={agent.id} title={wide ? undefined : 'Agent'} onClick={() => actions.openAgent(agent.id)} onContextMenu={(event) => { event.preventDefault(); actions.openMenu({ kind: 'agent', id: agent.id, x: event.clientX, y: event.clientY }); }}><span className={`bt-agent-ava${running ? ' bt-run' : ''}`}>{h(FishLogo, { size: 22 })}</span>{wide ? <span className='bt-row-body'><span className='bt-row-name'>{t('Agent')}</span>{preview ? <span className='bt-row-preview'>{preview}</span> : null}</span> : null}{wide && unread && !active ? <span className='bt-unread' aria-hidden/> : null}</button><div className='bt-agent-sub' data-open={open || undefined}><div className='bt-agent-sub-in'><button type='button' className='bt-agent-sub-row bt-agent-new' style={{ '--i': 0 }} onClick={() => { void actions.newAgentSession(agent.id).catch(error => actions.reportError(error, 'agent-session')); }}><PlusIcon /><span className='bt-agent-sub-title'>{t('New session')}</span></button>{sessions.map((session, index) => <AgentSessionRow key={session.id} session={session} agent={agent} actions={actions} index={index + 1} renaming={renaming === session.id} />)}</div></div></div>;
}
export function useListGlide(listRef: RefObject<HTMLDivElement | null>, layout: boolean, key: string): void {
    const tops = useRef({ layout, map: new Map() });
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list)
            return;
        const next = new Map();
        const still = reducedMotion() || tops.current.layout !== layout;
        for (const row of list.querySelectorAll<HTMLElement>('[data-bot-id],[data-room-id],[data-agent-id]')) {
            const id = row.dataset.botId ?? row.dataset.roomId ?? row.dataset.agentId;
            // offsetTop ignores transforms, so a glide in flight does not skew the next one.
            const top = row.offsetTop;
            next.set(id, top);
            const before = tops.current.map.get(id);
            if (!still && before !== undefined && Math.abs(before - top) > 0.5) {
                row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], SPRING_ROW_GLIDE);
            }
        }
        tops.current = { layout, map: next };
    }, [layout, key]);
}
// Moon Bot: the list sorts by recent activity until the user drags a row; then the
// dragged order holds (pinned rows still first, new rows on top). Saved per browser.
export const readOrder = (): string[] | null => {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE.sidebarOrder) ?? 'null') as unknown;
        return Array.isArray(value) ? value as string[] : null;
    }
    catch {
        return null;
    }
};
export const saveOrder = (ids: readonly string[]): void => { try {
    localStorage.setItem(STORAGE.sidebarOrder, JSON.stringify(ids));
}
catch { } };
export function manualSort(entries: readonly TSidebarEntry[], manual: readonly string[] | null): TSidebarEntry[] {
    if (!manual)
        return [...entries];
    const index = new Map(manual.map((id, at) => [id, at] as const));
    return [...entries].sort((a, b) => Number(Boolean(b.item.pinned)) - Number(Boolean(a.item.pinned))
        || (index.get(a.item.id) ?? -1) - (index.get(b.item.id) ?? -1));
}
