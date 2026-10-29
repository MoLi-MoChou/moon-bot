import { Fragment, type Ref, createElement as h, useEffect, useRef, useState } from 'react';
import { FishLogo } from './primitives.tsx';
import { isMainOf } from './sources.ts';
import { currentPart, stripHeader } from './text.ts';
import { PlusIcon, SearchIcon, PeopleIcon, CloseIcon, GearIcon } from './icons.tsx';
import { BotAvatar, RoomAvatar } from './mark.tsx';
import { useEscape } from './overlay-hooks.ts';
import { EmptyState } from './empty-state.tsx';
import { DIALOG_EXIT_MS, QUICK_EDGES, reducedMotion, useFlip, useGlide } from './motion.tsx';
import type { ReactNode } from 'react';
import { t } from './i18n.ts';
// The roster fields the palette reads to build its rows.
interface PaletteBot {
    id: string;
    name: string;
    role?: string;
    hidden?: boolean;
    sessionId?: string;
}
interface PaletteRoom {
    id: string;
    name: string;
    hidden?: boolean;
    members: readonly string[];
}
interface PaletteAgent {
    id: string;
}
export interface PaletteRoster {
    bots: PaletteBot[];
    rooms: PaletteRoom[];
    agents?: PaletteAgent[];
    byId: Record<string, PaletteBot | undefined>;
    roomsById: Record<string, PaletteRoom | undefined>;
    exchangeTurns: Record<string, number[] | undefined>;
    mainBotIds?: readonly string[];
}
// A turn outline entry as the session projections carry it.
interface OutlineEntry {
    turn: number;
    response?: string;
    prompt?: string;
}
interface SessionList {
    byId: Record<string, {
        projectionValues?: {
            turnOutline?: unknown;
        };
    } | undefined>;
    projectionsBySession?: Record<string, {
        values?: {
            turnOutline?: unknown;
        };
    } | undefined>;
}
type SessionsHook = <T>(select: (list: SessionList) => T) => T;
interface PaletteRow {
    key: string;
    avatar?: ReactNode;
    icon?: ReactNode;
    title: string;
    subtitle?: string | undefined;
    badge?: string | undefined;
    run: () => unknown;
}
export interface PaletteActions {
    closePalette: (token: string) => void;
    setFlags: (id: string, flags: {
        hidden?: boolean;
    }) => Promise<unknown>;
    openSession: (id: string) => void;
    openAgent: (id: string) => void;
    openNewChat: (mode: string) => void;
    openSettings: (page: string) => void;
    reportError: (error: unknown, where: string) => void;
}
export interface CommandPaletteProps {
    start?: string | undefined;
    token: string;
    roster: PaletteRoster;
    actions: PaletteActions;
    useSessions: SessionsHook;
}
// Search is a command palette: a 560px dialog, a search header, and 49px
// rows (24px avatar, title, subtitle). Bots and groups match on name and role; past
// messages match on their text.
export function CommandPalette({ start, token, roster, actions, useSessions }: CommandPaletteProps) {
    const [query, setQuery] = useState(start ?? '');
    const [cursor, setCursor] = useState(0);
    const [leaving, setLeaving] = useState(false);
    const input = useRef<HTMLInputElement | null>(null);
    const wanted = query.trim().toLowerCase();
    const close = () => {
        if (leaving)
            return;
        setLeaving(true);
        setTimeout(() => actions.closePalette(token), reducedMotion() ? 0 : DIALOG_EXIT_MS);
    };
    useEscape(close);
    const ids = [...roster.bots.map(currentPart), ...roster.rooms.map(item => item.id)];
    const found = useSessions((list) => {
        if (wanted.length < 2)
            return '[]';
        const hits: [
            string,
            number,
            string
        ][] = [];
        for (const id of ids) {
            const outline = list.projectionsBySession?.[id]?.values?.turnOutline ?? list.byId[id]?.projectionValues?.turnOutline as OutlineEntry[] | undefined;
            if (!Array.isArray(outline))
                continue;
            const hidden = roster.exchangeTurns[id] ?? [];
            for (let index = outline.length - 1; index >= 0 && hits.length < 30; index -= 1) {
                const entry = outline[index];
                if (hidden.includes(entry.turn))
                    continue;
                for (const raw of [entry.response, entry.prompt]) {
                    const text = stripHeader(raw ?? '').replace(/\s+/g, ' ').trim();
                    const at = text.toLowerCase().indexOf(wanted);
                    if (at < 0)
                        continue;
                    const from = Math.max(0, at - 24);
                    hits.push([id, entry.turn, (from > 0 ? '…' : '') + text.slice(from, at + wanted.length + 60)]);
                    break;
                }
            }
        }
        return JSON.stringify(hits);
    }) as string;
    const matchesName = (...fields: (string | undefined)[]) => wanted === '' || fields.some(field => (field ?? '').toLowerCase().includes(wanted));
    const sections: [
        string,
        PaletteRow[]
    ][] = [];
    const people: PaletteRow[] = [
        ...roster.bots.filter(bot => matchesName(bot.name, bot.role)).map(bot => ({
            key: bot.id, avatar: <BotAvatar bot={bot} size={24} badge={false} live={false} />, title: bot.name,
            subtitle: [bot.role, isMainOf(roster, bot.id) ? t('Main Bot') : ''].filter(Boolean).join(' · '), badge: bot.hidden ? t('Hidden') : undefined,
            run: async () => { if (bot.hidden)
                await actions.setFlags(bot.id, { hidden: false }); actions.openSession(bot.id); },
        })),
        ...roster.rooms.filter(room => matchesName(room.name)).map(room => ({
            key: room.id, avatar: <RoomAvatar room={room as unknown as {
                    members: readonly string[];
                }} roster={roster} size={24} />, title: room.name, subtitle: t('{count} members', { count: room.members.length }),
            badge: room.hidden ? t('Hidden') : undefined,
            run: async () => { if (room.hidden)
                await actions.setFlags(room.id, { hidden: false }); actions.openSession(room.id); },
        })),
    ];
    if (people.length)
        sections.push([t('Bots'), people]);
    const agents: PaletteRow[] = (roster.agents ?? []).filter(() => matchesName('Agent')).map(agent => ({
        key: agent.id, avatar: <span className='bt-palette-agent'>{h(FishLogo, { size: 18 })}</span>, title: 'Agent',
        subtitle: t('Plain agent session'),
        run: () => actions.openAgent(agent.id),
    }));
    if (agents.length)
        sections.push(['Agent', agents]);
    const messages: PaletteRow[] = (JSON.parse(found) as [
        string,
        number,
        string
    ][]).map(([id, turn, snippet]) => {
        const bot = roster.byId[id];
        const room = roster.roomsById[id];
        return {
            key: `${id}:${turn}`, title: bot?.name ?? room?.name ?? t('Bot'), subtitle: snippet,
            avatar: bot ? <BotAvatar bot={bot} size={24} badge={false} live={false} /> : <RoomAvatar room={room as unknown as {
                    members: readonly string[];
                }} roster={roster} size={24} />,
            run: () => actions.openSession(id),
        };
    });
    if (messages.length)
        sections.push([t('Messages'), messages]);
    const commands: PaletteRow[] = [
        { key: 'cmd:new', icon: <PlusIcon />, title: t('New chat'), run: () => actions.openNewChat('new') },
        { key: 'cmd:bot', icon: <PlusIcon />, title: t('Create Bot'), run: () => actions.openNewChat('create') },
        { key: 'cmd:group', icon: <PeopleIcon />, title: t('Create group chat'), run: () => actions.openNewChat('group') },
        { key: 'cmd:settings', icon: <GearIcon />, title: t('Bot settings'), run: () => actions.openSettings('general') },
    ].filter(command => matchesName(command.title));
    if (commands.length)
        sections.push([t('Commands'), commands]);
    const rows = sections.flatMap(([, items]) => items);
    const active = Math.min(cursor, Math.max(rows.length - 1, 0));
    const shown = rows.map(row => row.key).join('\n');
    const glide = useGlide(`${active}\n${shown}`, { axis: 'y', ...QUICK_EDGES });
    const listRef = glide.box;
    useFlip(listRef, shown, '[data-flip]');
    useEffect(() => {
        listRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
    }, [active, query]);
    const choose = (row: PaletteRow | undefined) => {
        if (!row || leaving)
            return;
        void Promise.resolve(row.run()).catch(error => actions.reportError(error, 'menu'));
        close();
    };
    let index = -1;
    return <div className='bt-palette-layer' data-leaving={leaving || undefined}><div className='bt-backdrop' onMouseDown={close}/><div className='bt-palette' role='dialog' aria-label={t('Search')} aria-modal><div className='bt-palette-head'><span className='bt-palette-glyph' aria-hidden><SearchIcon /></span><input ref={input} autoFocus value={query} placeholder={t('Search Bots, chats and messages')} aria-label={t('Search')} role='combobox' aria-expanded aria-controls='bt-palette-list' onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setCursor(0); }} onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing)
            return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setCursor(Math.min(active + 1, rows.length - 1));
        }
        else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor(Math.max(active - 1, 0));
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            choose(rows[active]);
        }
    }}/>{query ? <button type='button' className='bt-palette-clear' aria-label={t('Clear search')} onClick={() => { setQuery(''); setCursor(0); }}><CloseIcon /></button> : null}</div><div ref={listRef as Ref<HTMLDivElement>} id='bt-palette-list' className='bt-palette-list' role='listbox' aria-label={t('Results')}><span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden/>{rows.length === 0
        ? <EmptyState icon={<SearchIcon />} title={t('No results for “{query}”', { query: query.trim() })} hint={t('Try a Bot name or words from a message')} action={{ label: t('Clear search'), onClick: () => { setQuery(''); setCursor(0); input.current?.focus(); } }} />
        : sections.map(([title, items]) => <><div className='bt-palette-section' role='presentation' data-flip={`section:${title}`}>{title}</div>{items.map((row) => {
            index += 1;
            const at = index;
            return <button key={row.key} type='button' role='option' className='bt-palette-row' aria-selected={at === active} data-flip={row.key} onMouseMove={() => { if (cursor !== at)
                setCursor(at); }} onClick={() => choose(row)}><span className='bt-palette-lead'>{row.avatar ?? <span className='bt-palette-cmd'>{row.icon}</span>}</span><span className='bt-palette-text'><span className='bt-palette-title'>{row.title}</span>{row.subtitle ? <span className='bt-palette-sub'>{row.subtitle}</span> : null}</span>{row.badge ? <span className='bt-palette-badge'>{row.badge}</span> : null}</button>;
        })}</>)}</div></div></div>;
}
