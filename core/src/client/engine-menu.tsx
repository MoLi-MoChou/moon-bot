import { Fragment, createElement as h, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, PencilIcon } from './icons.tsx';
import { Caret, useAnchoredMenu } from './model-menu.tsx';
import { t } from './i18n.ts';
import type { BotPatch, SettingsBot, SettingsBotEngine, SettingsEngineOption } from './settings-types.ts';

// Engine menu: the picker for what runs a Bot's turns — the built-in runtime,
// a local ACP agent on the machine, an on-demand ACP agent via npx, or a remote
// agent invited over the relay. Same anchored menu as the model and folder pickers.
export interface EngineMenuProps {
    bot: SettingsBot;
    save: (patch: BotPatch) => Promise<boolean>;
    refreshEngines?: (() => Promise<{ engines: readonly SettingsEngineOption[]; of: Readonly<Record<string, string>> }>) | undefined;
    wide?: boolean;
}

export interface EngineChoice {
    readonly name: string;
    readonly sub: string | undefined;
}

const Tick = ({ on }: { on: boolean }) => <span className='bt-model-tick' aria-hidden>{on ? h(CheckIcon) : null}</span>;

// What the trigger shows for the Bot's current engine.
export function engineChoiceOf(bot: SettingsBot, available: readonly SettingsEngineOption[]): EngineChoice {
    const engine = bot.engine;
    if (engine?.kind === 'acp-remote') {
        const agentId = engine.agentId ?? '';
        const entry = available.find(item => item.kind === 'acp-remote' && item.id === `remote:${agentId}`);
        return { name: agentId !== '' ? agentId : t('Remote agent'), sub: entry !== undefined ? (entry.online === true ? t('Remote · online') : t('Remote · offline')) : t('Remote agent') };
    }
    if (engine?.kind !== 'acp') {
        return { name: t('Built-in'), sub: t('Moon Bot runtime') };
    }
    const key = bot.runtimeId ?? engine.key ?? engine.command ?? '';
    const entry = available.find(item => item.kind === 'acp' && (item.id === key || (item.command === engine.command && (item.args ?? []).join(' ') === (engine.args ?? []).join(' '))));
    if (entry !== undefined) {
        return {
            name: entry.label,
            sub: entry.onDemand ? t('On-demand (npx)') : [entry.version, t('Local ACP agent')].filter(Boolean).join(' · '),
        };
    }
    return { name: engine.command ?? '', sub: t('Custom command') };
}

export function EngineMenu({ bot, save, refreshEngines, wide = false }: EngineMenuProps) {
    const [available, setAvailable] = useState<readonly SettingsEngineOption[]>([]);
    const [view, setView] = useState<'list' | 'custom'>('list');
    const [draft, setDraft] = useState('');
    const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu(() => {
        if (view !== 'list') {
            setView('list');
            return true;
        }
        return false;
    });

    useEffect(() => {
        if (!refreshEngines) return undefined;
        let alive = true;
        void refreshEngines().then(result => { if (alive) setAvailable(result.engines); });
        return () => { alive = false; };
    }, [refreshEngines, bot.id]);

    const engine = bot.engine;
    const currentOf = (id: string): boolean => {
        if (id === 'builtin') return engine?.kind !== 'acp' && engine?.kind !== 'acp-remote';
        if (id.startsWith('remote:')) {
            const agentId = id.slice('remote:'.length);
            return engine?.kind === 'acp-remote' && (bot.runtimeId === id || engine.agentId === agentId);
        }
        const key = bot.runtimeId ?? engine?.key ?? '';
        if (key !== '') return engine?.kind === 'acp' && key === id;
        const entry = available.find(item => item.id === id);
        return engine?.kind === 'acp' && entry !== undefined && entry.command === engine?.command && (entry.args ?? []).join(' ') === (engine.args ?? []).join(' ');
    };

    const toggle = (): void => {
        if (isOpen) {
            close();
            return;
        }
        setView('list');
        void refreshEngines?.().then(result => setAvailable(result.engines)).catch(() => undefined);
        open();
    };

    const choose = (id: string): void => {
        close();
        if (id === 'builtin') {
            if (engine?.kind !== 'builtin') void save({ engine: null, runtimeId: null });
            return;
        }
        if (id.startsWith('remote:')) {
            const agentId = id.slice('remote:'.length);
            if (!(engine?.kind === 'acp-remote' && engine.agentId === agentId))
                void save({ engine: { kind: 'acp-remote', agentId }, runtimeId: id });
            return;
        }
        const entry = available.find(item => item.id === id && item.kind === 'acp');
        if (entry?.command !== undefined) {
            const next: SettingsBotEngine = {
                kind: 'acp',
                command: entry.command,
                args: entry.args ?? [],
                key: entry.key ?? entry.id,
            };
            void save({ engine: next, runtimeId: entry.id });
        }
    };

    const typed = (): void => {
        const command = draft.trim();
        if (command === '') return;
        close();
        void save({ engine: { kind: 'acp', command, args: [] }, runtimeId: null });
    };

    const local = available.filter(entry => entry.kind === 'acp' && entry.selectable !== false && !entry.onDemand);
    const ondemand = available.filter(entry => entry.kind === 'acp' && entry.selectable !== false && Boolean(entry.onDemand));
    const remote = available.filter(entry => entry.kind === 'acp-remote');
    const unsupported = available.filter(entry => entry.kind !== 'acp' && entry.kind !== 'acp-remote' && entry.kind !== 'builtin');
    const engineKey = bot.runtimeId ?? engine?.key ?? engine?.command ?? '';
    const customCurrent = engine?.kind === 'acp' && !available.some(entry => entry.id === engineKey || (entry.command === engine?.command && (entry.args?.join(' ') ?? '') === (engine?.args?.join(' ') ?? '')))
        ? [{ id: `custom:${engine.command ?? ''}`, label: engine.command ?? '', command: engine.command ?? '', args: engine.args ?? [], kind: 'acp' } satisfies SettingsEngineOption]
        : [];
    const shown = engineChoiceOf(bot, available);

    const listView = <div key='list' className='bt-engine-view'>
        <button type='button' role='menuitemradio' aria-checked={engine?.kind !== 'acp' && engine?.kind !== 'acp-remote'} onClick={() => choose('builtin')}>
            <span className='bt-engine-copy'>
                <span className='bt-menu-label'>{t('Built-in')}</span>
                <span className='bt-engine-sub'>{t('Moon Bot runtime')}</span>
            </span>
            {h(Tick, { on: engine?.kind !== 'acp' && engine?.kind !== 'acp-remote' })}
        </button>
        {(local.length > 0 || customCurrent.length > 0) ? <div className='bt-model-group' role='presentation'>{t('Local agents')}</div> : null}
        {customCurrent.map(entry => <span key={entry.id} className='bt-engine-off' role='menuitemradio' aria-checked='true' aria-disabled='true' title={entry.command}><span className='bt-engine-copy'><span className='bt-menu-label'>{entry.command}</span><span className='bt-engine-sub'>{t('Current configuration')}</span></span>{h(Tick, { on: true })}</span>)}
        {local.map(entry => <button key={entry.id} type='button' role='menuitemradio' aria-checked={currentOf(entry.id)} title={entry.path} onClick={() => choose(entry.id)}><span className='bt-engine-copy'><span className='bt-menu-label'>{entry.label}</span><span className='bt-engine-sub'>{[entry.version, entry.path].filter(Boolean).join(' · ')}</span></span>{h(Tick, { on: currentOf(entry.id) })}</button>)}
        {ondemand.length > 0 ? <div className='bt-model-group' role='presentation'>{t('On-demand agents (npx)')}</div> : null}
        {ondemand.map(entry => <button key={entry.id} type='button' role='menuitemradio' aria-checked={currentOf(entry.id)} title={`npx ${(entry.args ?? []).join(' ')}`} onClick={() => choose(entry.id)}><span className='bt-engine-copy'><span className='bt-menu-label'>{entry.label}</span><span className='bt-engine-sub'>{`npx ${(entry.args ?? []).join(' ')}`}</span></span>{h(Tick, { on: currentOf(entry.id) })}</button>)}
        {remote.length > 0 ? <div className='bt-model-group' role='presentation'>{t('Remote agents')}</div> : null}
        {remote.map(entry => <button key={entry.id} type='button' role='menuitemradio' aria-checked={currentOf(entry.id)} onClick={() => choose(entry.id)}><span className='bt-engine-copy'><span className='bt-menu-label'>{h('span', { className: 'bt-engine-dot', 'data-online': entry.online === true ? '' : undefined, 'aria-hidden': true })}{entry.label}</span><span className='bt-engine-sub'>{entry.online === true ? t('Connected') : t('Not connected')}</span></span>{h(Tick, { on: currentOf(entry.id) })}</button>)}
        {unsupported.length > 0 ? <div className='bt-model-group' role='presentation'>{t('Detected non-ACP tools')}</div> : null}
        {unsupported.map(entry => <span key={entry.id} className='bt-engine-off' role='menuitem' aria-disabled='true' title={entry.reason}><span className='bt-engine-copy'><span className='bt-menu-label'>{entry.label}</span><span className='bt-engine-sub'>{entry.version ?? ''}{entry.reason !== undefined && entry.version !== undefined ? ' · ' : ''}{entry.reason ?? ''}</span></span></span>)}
        <div className='bt-menu-sep' role='separator'/>
        <button type='button' role='menuitem' onClick={() => { setDraft(engine?.kind === 'acp' ? engine.command ?? '' : ''); setView('custom'); }}>{h(PencilIcon)}<span className='bt-menu-label'>{t('Custom command…')}</span></button>
    </div>;

    const customView = <div key='custom' className='bt-engine-view'><input className='bt-folder-input' autoFocus value={draft} spellCheck={false} aria-label={t('ACP command')} placeholder='opencode' onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) typed(); }}/><button type='button' role='menuitem' className='bt-folder-use' disabled={draft.trim() === ''} onClick={typed}>{t('Use this command')}</button></div>;
    const shownView = view === 'custom' ? customView : listView;

    return <><button ref={button} type='button' className='bt-model-trigger' data-wide={wide || undefined} aria-haspopup='menu' aria-expanded={isOpen} aria-label={t('Engine: {engine}', { engine: shown.name })} onClick={toggle} onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => { if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        toggle();
    } }}><span className='bt-model-copy'><span className='bt-model-name'>{shown.name}</span>{shown.sub !== undefined ? <span className='bt-model-provider'>{shown.sub}</span> : null}</span>{h(Caret)}</button>{shownPlace ? createPortal(<div ref={menu} className={`bt-menu bt-model-menu bt-engine-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`} role='menu' aria-label={t('Execution engine')} style={shownPlace} data-leaving={leaving || undefined}>{shownView}</div>, document.body) : null}</>;
}

export const ENGINE_CSS = `
.bt-engine-view{display:flex;flex-direction:column;gap:2px;animation:bt-veil-in .14s ease-out}
.bt-engine-copy{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-engine-copy .bt-menu-label{flex:none}
.bt-engine-sub{min-width:0;font-size:11px;line-height:14px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-menu .bt-engine-off{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;text-align:left;opacity:.55;cursor:default}
.bt-engine-dot{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--bt-ink-3);flex:none}
.bt-engine-dot[data-online]{background:var(--bt-green);animation:bt-engine-pulse 2.4s ease-out infinite}
@keyframes bt-engine-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bt-green) 45%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.bt-engine-view{animation:none}.bt-engine-dot[data-online]{animation:none}}
`;
