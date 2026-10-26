import { Fragment, createElement as h, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CommandPalette } from './palette.tsx';
import { NewChat } from './new-chat.tsx';
import type { NewChatActions, NewChatRoster } from './new-chat.tsx';
import { ExchangeDialog } from './exchange.tsx';
import { VoiceMode } from './voice.tsx';
import type { VoiceActions, VoiceRoster } from './voice.tsx';
import { SettingsDialog } from './features/settings/settings.tsx';
import type { SettingsDialogProps } from './features/settings/settings.tsx';
import type { SettingsActions, SettingsRoster } from './features/settings/settings-types.ts';
import { ContextMenu } from './context-menu.tsx';
import { BotPanel } from './features/browser/index.ts';
import type { BrowserPagesHook, BrowserTabsHook, PanelActions } from './features/browser/index.ts';
import { MemoryDialog } from './features/memory/index.ts';
import type { MemoryActions } from './features/memory/index.ts';
import { DIALOG_EXIT_MS, MENU_EXIT_MS, PANEL_LINGER_MS, reducedMotion, useLinger } from './motion.tsx';
import type { ExchangeActions } from './exchange.tsx';
import type { ContextMenuActions, ContextRoster } from './context-menu.tsx';
// A context menu the user opened: what it is about, and where it was opened.
interface MenuState {
    readonly kind?: string | undefined;
    readonly id?: string | undefined;
    readonly x: number;
    readonly y: number;
}
// A store hook from the plugin's inject: it selects from one source and re-renders on
// change. Every field the overlay root reads is optional, because each hook selects
// from its own store (the roster, the ui state, the sessions list).
interface OverlayValue {
    byId: Record<string, {
        id: string;
        name: string;
        retainedBy?: {
            mainView?: number;
        };
    } | undefined>;
    roomsById: Record<string, {
        id: string;
        name: string;
    } | undefined>;
    details?: string | null;
    view?: string;
    renaming?: boolean;
    tab?: string;
    settings?: {
        page?: string;
        id?: string;
    } | null;
    memory?: string | null;
    menu?: MenuState | null;
    newChat?: string | null;
    palette?: {
        token: string;
        query?: string;
    } | null;
    exchange?: [
        string,
        string
    ] | null;
    voice?: string | null;
}
type StoreHook = <T>(select: (value: OverlayValue) => T) => T;
export interface OverlaysActions {
    followPanel?: (sessionId: string) => void;
    [key: string]: unknown;
}
export interface OverlaysProps {
    useRoster: StoreHook;
    useUi: StoreHook;
    useSessions: StoreHook;
    useSessionStatus: StoreHook;
    useActivity: StoreHook;
    useWork: StoreHook;
    useRegistry: StoreHook;
    useBrowserPages: StoreHook;
    useBrowserTabs: StoreHook;
    useUpdate: StoreHook;
    actions: OverlaysActions;
}
export function Overlays({ useRoster, useUi, useSessions, useSessionStatus, useActivity, useWork, useRegistry, useBrowserPages, useBrowserTabs, useUpdate, actions }: OverlaysProps) {
    const roster = useRoster(value => value);
    const ui = useUi(value => value);
    useRegistry(value => value);
    const current = useSessions(list => Object.values(list.byId ?? {}).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? null);
    // An open panel follows the conversation in the main view. Only a change of the
    // main view moves it, so opening details for another id (Rename) is not undone.
    const previous = useRef(current);
    useEffect(() => {
        if (previous.current === current)
            return;
        previous.current = current;
        if (current)
            actions.followPanel?.(current);
    }, [current]);
    const open = ui.details ? { id: ui.details, view: ui.view ?? 'details', renaming: ui.renaming, tab: ui.tab } : null;
    const [kept, setKept] = useState<typeof open>(open);
    useEffect(() => {
        if (open) {
            setKept(open);
            return undefined;
        }
        const timer = setTimeout(() => setKept(null), reducedMotion() ? 0 : PANEL_LINGER_MS);
        return () => clearTimeout(timer);
    }, [ui.details, ui.view, ui.renaming, ui.tab]);
    const pane = open ?? kept;
    const [settings, settingsLeaving] = useLinger(ui.settings, DIALOG_EXIT_MS);
    // The memory dialog shows a Bot's memory or a group chat's.
    const memoryOwner = (id: string): {
        id: string;
        name: string;
        group?: boolean;
    } | null => {
        const bot = roster.byId?.[id];
        if (bot)
            return { id: bot.id, name: bot.name };
        const room = roster.roomsById?.[id];
        return room ? { id: room.id, name: room.name, group: true } : null;
    };
    const [memory, memoryLeaving] = useLinger(ui.memory && memoryOwner(ui.memory) ? ui.memory : null, DIALOG_EXIT_MS);
    const owner = memory ? memoryOwner(memory) : null;
    const [menu, menuLeaving] = useLinger(ui.menu, MENU_EXIT_MS);
    return <>{pane ? createPortal(h(BotPanel, {
        pane,
        leaving: open === null,
        roster,
        actions: actions as unknown as PanelActions,
        useSessions,
        useSessionStatus,
        useActivity,
        useWork,
        useBrowserTabs: useBrowserTabs as unknown as BrowserTabsHook,
        useBrowserPages: useBrowserPages as unknown as BrowserPagesHook,
    }), document.body) : null}{ui.newChat ? createPortal(h(NewChat, { key: ui.newChat, mode: ui.newChat, roster: roster as unknown as NewChatRoster, actions: actions as unknown as NewChatActions }), document.body) : null}{ui.palette ? createPortal(h(CommandPalette, { key: ui.palette.token, start: ui.palette.query, token: ui.palette.token, roster: roster as never, actions: actions as never, useSessions: useSessions as never }), document.body) : null}{ui.exchange ? createPortal(h(ExchangeDialog, { pair: ui.exchange, roster: roster as never, actions: actions as unknown as ExchangeActions }), document.body) : null}{ui.voice ? createPortal(h(VoiceMode, { key: ui.voice, sessionId: ui.voice, roster: roster as unknown as VoiceRoster, actions: actions as unknown as VoiceActions, useSessions: useSessions as never, useSessionStatus: useSessionStatus as never }), document.body) : null}{menu ? createPortal(h(ContextMenu, { key: `${menu.kind ?? ''}:${menu.id}:${menu.x}:${menu.y}`, menu: menu as never, roster: roster as unknown as ContextRoster, actions: actions as unknown as ContextMenuActions, leaving: menuLeaving }), document.body) : null}{settings ? createPortal(h(SettingsDialog, { page: settings.page, id: settings.id, roster: roster as unknown as SettingsRoster, actions: actions as unknown as SettingsActions, useUpdate: useUpdate as unknown as SettingsDialogProps['useUpdate'], leaving: settingsLeaving }), document.body) : null}{owner ? createPortal(h(MemoryDialog, { key: owner.id, owner, actions: actions as unknown as MemoryActions, leaving: memoryLeaving }), document.body) : null}</>;
}
