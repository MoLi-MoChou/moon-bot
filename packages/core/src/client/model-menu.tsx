import { CompactChat, ContextGauge, useContext } from './model-context.tsx';
import type { ContextValues } from './model-context.tsx';
export type { ContextPressure, ContextValues, ContextUsage } from './model-context.tsx';
export { contextOf } from './model-context.tsx';
// Model menu: picker, thinking levels, and context gauge.
import { Fragment, createElement as h, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ElementType } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, SlidersIcon } from './icons.tsx';
import { MENU_EXIT_MS, useLinger } from './motion.tsx';
import { useEscape, useMenuKeys } from './overlay-hooks.ts';
import { t } from './i18n.ts';
import { manageModels } from './model-menu-manage.ts';
// A Bot's model: the picker in its details panel and settings, and the message its
// chat opens on while it has none. Models come from DeepSeek Harness, grouped by provider.
// A thinking level a model serves, and the levels of one model.
export interface ModelReasoningEffort {
    id: string;
    name: string;
}
export interface ModelReasoning {
    efforts: readonly ModelReasoningEffort[];
    defaultEffort?: string | undefined;
}
// One model the catalog lists; the rest of its entry passes through.
export interface ModelEntry {
    ref: string;
    provider?: string | undefined;
    providerName?: string | undefined;
    name?: string | undefined;
    needsKey?: boolean | undefined;
    reasoning?: ModelReasoning | undefined;
}
export type ModelGroup = [
    string,
    ModelEntry[]
];
export interface ModelInfo {
    ref: string;
    name: string;
    provider: string;
    served: boolean;
}
export interface EffortRow {
    effort: string | undefined;
    label: string;
}
export function groupModels(models: readonly ModelEntry[] | undefined): ModelGroup[] {
    const groups = new Map<string, ModelEntry[]>();
    for (const model of models ?? []) {
        const provider = model.provider ?? model.providerName ?? model.ref.split('/')[0] ?? model.ref;
        if (!groups.has(provider))
            groups.set(provider, []);
        groups.get(provider)?.push(model);
    }
    const names = new Map<string, number>();
    for (const [provider, list] of groups) {
        const name = list[0]?.providerName ?? provider;
        names.set(name, (names.get(name) ?? 0) + 1);
    }
    return [...groups].map(([provider, list]): ModelGroup => {
        const name = list[0]?.providerName ?? provider;
        return [(names.get(name) ?? 0) > 1 ? `${name} (${provider})` : name, list];
    });
}
export const servedOf = (roster: {
    models?: readonly ModelEntry[] | undefined;
}, ref: string | undefined): ModelEntry | undefined => (roster.models ?? []).find(model => model.ref === ref);
// What a Bot runs on, for display: the chosen model, else the one it last ran on.
export function modelOf(bot: {
    model?: string | undefined;
    appliedModel?: string | undefined;
}, roster: {
    models?: readonly ModelEntry[] | undefined;
}): ModelInfo | undefined {
    const ref = bot.model ?? bot.appliedModel;
    if (!ref)
        return undefined;
    const served = servedOf(roster, ref);
    const [provider = '', ...rest] = ref.split('/');
    return { ref, name: served?.name ?? rest.join('/'), provider: served?.providerName ?? provider, served: served !== undefined };
}
// The thinking levels of one model, `{efforts, defaultEffort?}` or undefined when it
// has none. The catalog carries them for models Bots use; any other ref asks the host.
const effortCache = new Map<string, ModelReasoning | null>();
export function useEfforts(served: ModelEntry | undefined, ref: string | undefined, actions: ModelMenuOptionalActions): ModelReasoning | null | undefined {
    const [fetched, setFetched] = useState<ModelReasoning | null | undefined>(undefined);
    useEffect(() => {
        setFetched(undefined);
        if (ref === undefined || served?.reasoning !== undefined || actions?.efforts === undefined)
            return undefined;
        let live = true;
        if (effortCache.has(ref))
            setFetched(effortCache.get(ref));
        else
            void Promise.resolve(actions.efforts(ref)).then((value) => {
                const reasoning = value?.efforts ? value : null;
                effortCache.set(ref, reasoning);
                if (live)
                    setFetched(reasoning);
            }).catch(() => { });
        return () => { live = false; };
    }, [ref, served?.reasoning !== undefined, actions]);
    return served?.reasoning ?? fetched;
}
// The rows of the Thinking section: a Default row that clears the Bot's pick, then every
// level the model serves.
export function effortRows(reasoning: ModelReasoning | null | undefined): EffortRow[] {
    if (reasoning?.efforts === undefined || reasoning.efforts.length === 0)
        return [];
    return [
        { effort: undefined, label: t('Default') },
        ...reasoning.efforts.map(effort => ({ effort: effort.id, label: effort.name })),
    ];
}
interface EffortRowsProps {
    reasoning: ModelReasoning | null | undefined;
    current: string | undefined;
    onPick: (effort: string | undefined) => void;
}
export function EffortRows({ reasoning, current, onPick }: EffortRowsProps) {
    return <><div className='bt-menu-sep' role='separator'/><div className='bt-model-group' role='presentation'>{t('Thinking level')}</div>{effortRows(reasoning).map(row => <button key={row.effort ?? 'default'} type='button' role='menuitemradio' aria-checked={row.effort === current} onClick={() => onPick(row.effort)}><span className='bt-menu-label'>{row.label}</span><span className='bt-model-tick' aria-hidden>{row.effort === current ? <CheckIcon /> : null}</span></button>)}</>;
}
interface ModelRowsProps {
    roster: ModelMenuRoster;
    current: string | undefined;
    onPick: (ref: string) => void;
}
export function ModelRows({ roster, current, onPick }: ModelRowsProps) {
    return groupModels(roster.models).map(([provider, list]) => <><div className='bt-model-group' role='presentation'>{provider}</div>{list.map(model => <button key={model.ref} type='button' role='menuitemradio' aria-checked={model.ref === current} title={model.ref} onClick={() => onPick(model.ref)}><span className='bt-menu-label'>{model.name}</span>{model.ref === roster.defaultModel ? <span className='bt-menu-hint'>{t('Default')}</span> : null}<span className='bt-model-tick' aria-hidden>{model.ref === current ? <CheckIcon /> : null}</span></button>)}</>);
}
export const Caret = () => <svg className='bt-model-caret' width={12} height={12} viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={1.8} strokeLinecap='round' strokeLinejoin='round' aria-hidden><path d='M5.5 8l4.5 4.5L14.5 8'/></svg>;
// Where a menu sits under its trigger: below when there is room, else above.
export interface MenuPlace extends CSSProperties {
    left: number;
    width: number;
    top?: number | undefined;
    bottom?: number | undefined;
    maxHeight: number;
    '--bt-origin': string;
}
export interface AnchoredMenu {
    isOpen: boolean;
    shownPlace: MenuPlace | null;
    leaving: boolean;
    button: React.RefObject<HTMLButtonElement | null>;
    menu: React.RefObject<HTMLDivElement | null>;
    open: () => void;
    close: () => void;
}
// A menu that opens under its trigger, or above when the window has no room below. A
// click outside, Escape, or a scroll outside it closes it.
export function useAnchoredMenu(onEscape?: (() => boolean | void) | undefined): AnchoredMenu {
    const [place, setPlace] = useState<MenuPlace | null>(null);
    const [shownPlace, leaving] = useLinger(place, MENU_EXIT_MS);
    const button = useRef<HTMLButtonElement | null>(null);
    const menu = useRef<HTMLDivElement | null>(null);
    const escapeRef = useRef(onEscape);
    escapeRef.current = onEscape;
    const close = (): void => setPlace(null);
    useMenuKeys(menu, place !== null);
    // Nested folder "browse/type" views return true from onEscape to stay open on the list.
    useEscape(() => {
        if (escapeRef.current?.() === true)
            return;
        close();
        button.current?.focus();
    }, place !== null);
    useEffect(() => {
        if (place === null)
            return undefined;
        const onDown = (event: MouseEvent): void => {
            if (event.target instanceof Node && (menu.current?.contains(event.target) || button.current?.contains(event.target)))
                return;
            close();
        };
        const onScroll = (event: Event): void => { if (event.target instanceof Node && !menu.current?.contains(event.target))
            close(); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [place]);
    const open = (): void => {
        const node = button.current;
        if (node === null)
            return;
        const rect = node.getBoundingClientRect();
        const width = Math.max(240, rect.width);
        const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        const below = window.innerHeight - rect.bottom;
        setPlace(below >= 260 || below >= rect.top
            ? { left, width, top: rect.bottom + 4, maxHeight: below - 16, '--bt-origin': 'top right' }
            : { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: rect.top - 16, '--bt-origin': 'bottom right' });
    };
    return { isOpen: place !== null, shownPlace, leaving, button, menu, open, close };
}
// The context figures the run-stats endpoint reports for one Bot.
// The sign-in entry the shell's account plugin puts in its slots, and the store a
// plugin hook reads.
export interface SignInSource<T = unknown> {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => T;
}
export interface SignInHooks {
    account: SignInSource;
    theme: SignInSource;
}
export interface SignInOps {
    hooks: SignInHooks;
    [key: string]: unknown;
}
export interface SignInEntry {
    component: ElementType;
    inject?: (() => SignInOps) | undefined;
}
export interface ModelMenuBot {
    id: string;
    name: string;
    model?: string | undefined;
    appliedModel?: string | undefined;
    effort?: string | undefined;
}
export interface ModelMenuRoster {
    models?: readonly ModelEntry[] | undefined;
    defaultModel?: string | null | undefined;
}
// The actions the picker may reach; a draft form passes only the ones its callbacks need.
export interface ModelMenuOptionalActions {
    updateBot?: UpdateBot | undefined;
    closeOverlay?: (() => void) | undefined;
    refreshModels?: (() => Promise<unknown>) | undefined;
    efforts?: ((ref: string) => Promise<ModelReasoning | null | undefined>) | undefined;
    runStats?: ((botId: string) => Promise<ContextValues | undefined>) | undefined;
    compactChat?: ((botId: string) => Promise<{ readonly compacted: boolean; readonly reason?: string | undefined }>) | undefined;
    openModels?: (() => void) | undefined;
    openShellSettingsPanel?: ((page?: string) => void) | undefined;
    canSignIn?: (() => boolean) | undefined;
    signIn?: (() => void) | undefined;
    openShellOnboardingPanel?: ((provider?: string) => void) | undefined;
    setProviderKey?: ((provider: string | undefined, value: string | null) => Promise<unknown>) | undefined;
    signInEntry?: (() => SignInEntry | null) | undefined;
    closeSignIn?: (() => void) | undefined;
    accountT?: (() => (key: string, params?: Record<string, unknown>) => string) | undefined;
}
export type UpdateBot = (id: string, patch: {
    model?: string | undefined;
    effort?: string | null | undefined;
}) => Promise<unknown>;
export interface ModelMenuActions extends ModelMenuOptionalActions {
    updateBot: UpdateBot;
}
export interface ModelMenuProps {
    bot: ModelMenuBot;
    roster: ModelMenuRoster;
    // A draft form passes its own callbacks and has no saver to run.
    run?: ((work: Promise<unknown>) => unknown) | undefined;
    actions: ModelMenuOptionalActions;
    wide?: boolean | undefined;
    onPick?: ((ref: string) => void) | undefined;
    onPickEffort?: ((effort: string | undefined) => void) | undefined;
}
// The trigger shows the model name over its provider. A Thinking section lists the
// levels of the shown model when it has them.
// `onPick`/`onPickEffort` replace saving to the Bot, for a Bot that does not exist yet.
export function ModelMenu(props: ModelMenuProps) {
    const { bot, roster, run, wide = false } = props;
    const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu();
    const shown = modelOf(bot, roster);
    const current = bot.model ?? bot.appliedModel;
    const served = servedOf(roster, current);
    const reasoning = useEfforts(served, current, props.actions);
    const context = useContext(bot.id, isOpen, props.actions);
    // The level the Bot runs on: its pick when the model serves it, else the model's own.
    const picked = reasoning?.efforts?.some(effort => effort.id === bot.effort) ? bot.effort : undefined;
    const currentEffort = picked ?? reasoning?.defaultEffort;
    const effortLabel = currentEffort === undefined
        ? ((reasoning?.efforts.length ?? 0) > 0 ? t('Default') : undefined)
        : reasoning?.efforts.find(effort => effort.id === currentEffort)?.name ?? currentEffort;
    const toggle = (): void => {
        if (isOpen) {
            close();
            return;
        }
        // the host settings can change the list at any time, so opening asks again.
        void props.actions.refreshModels?.();
        open();
    };
    const pick = (ref: string): void => {
        close();
        if (props.onPick) {
            props.onPick(ref);
            return;
        }
        const updateBot = props.actions.updateBot;
        if (updateBot !== undefined && run !== undefined && (ref !== current || !bot.model))
            void run(updateBot(bot.id, { model: ref }));
    };
    const pickEffort = (effort: string | undefined): void => {
        close();
        if (props.onPickEffort) {
            props.onPickEffort(effort);
            return;
        }
        const updateBot = props.actions.updateBot;
        if (updateBot !== undefined && run !== undefined && effort !== bot.effort)
            void run(updateBot(bot.id, { effort: effort ?? null }));
    };
    const models = roster.models ?? [];
    const manage = manageModels(props.actions);
    return <><button ref={button} type='button' className='bt-model-trigger' data-wide={wide || undefined} aria-haspopup='menu' aria-expanded={isOpen} aria-label={t('Model: {model}', { model: shown?.name ?? t('none') })} data-missing={shown !== undefined && !shown.served && models.length > 0 ? '' : undefined} onClick={toggle} onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => { if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        toggle();
    } }}><span className='bt-model-copy'><span className='bt-model-name'>{shown?.name ?? t('Choose a model')}</span>{shown ? <span className='bt-model-provider'>{shown.served || models.length === 0
        ? (effortLabel === undefined ? shown.provider : `${shown.provider} · ${effortLabel}`)
        : t('{provider} · not available', { provider: shown.provider })}</span> : null}</span><Caret /></button>{shownPlace ? createPortal(<div ref={menu} className={`bt-menu bt-model-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`} role='menu' aria-label={t('Model for {name}', { name: bot.name })} style={shownPlace} data-leaving={leaving || undefined}>{context ? <ContextGauge context={context} /> : null}<CompactChat botId={bot.id} compact={props.actions.compactChat} />{context ? <div className='bt-menu-sep' role='separator'/> : null}{models.length > 0 ? h(ModelRows, { roster, current, onPick: pick })
        : <div className='bt-model-none'>{t('No models are set up yet.')}</div>}{effortRows(reasoning).length > 0 ? <EffortRows reasoning={reasoning} current={picked} onPick={pickEffort} /> : null}{manage ? <div className='bt-menu-sep' role='separator'/> : null}{manage ? <button type='button' role='menuitem' onClick={() => { close(); manage(); }}><SlidersIcon /><span className='bt-menu-label'>{t('Models and providers…')}</span></button> : null}</div>, document.body) : null}</>;
}

export { ModelChoiceDock } from './model-choice.tsx';
