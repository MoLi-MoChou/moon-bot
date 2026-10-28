// The Models page of a window that has no DSH settings of its own: the model providers
// DSH serves, with their API keys and models, and the providers it can add. DSH keeps
// all of it; a key only ever travels from these inputs to the host.
import { createElement as h, useEffect, useState } from 'react';
import { CheckIcon, TrashIcon } from './icons.tsx';
import { KeyIcon, MaskedInput } from './secret-card.tsx';
import { Segmented, SPRING_SHAPE } from './motion.tsx';
import { hostText, t } from './i18n.ts';
// A model provider as DSH reports it: its models, its key state, and whether it can go.
interface ProviderModel {
    ref: string;
    name: string;
}
export interface Provider {
    id: string;
    name: string;
    key: {
        configured: boolean;
        writable?: boolean;
    } | null;
    models: readonly ProviderModel[];
    error?: string;
    removable?: boolean;
}
// The page's view of DSH's provider set.
export interface ProvidersView {
    available: boolean;
    providers: readonly Provider[];
    addable: readonly {
        id: string;
        name: string;
    }[];
    protocols: readonly string[];
}
export interface ProvidersActions {
    providers: () => Promise<ProvidersView>;
    setProviderKey: (id: string, key: string | null) => Promise<unknown>;
    removeProvider: (id: string) => Promise<unknown>;
    addProvider: (payload: Record<string, unknown>) => Promise<unknown>;
    providerModels: (payload: {
        baseURL: string;
        api: string;
        key: string;
    }) => Promise<readonly {
        id: string;
        name?: string;
    }[]>;
}
export type RunWork = (work: Promise<unknown>) => Promise<boolean | undefined>;
type Apply = (promise: Promise<unknown>) => Promise<unknown>;
const PROTOCOL_NAMES: Record<string, string> = { 'openai-completions': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' };
// Anthropic's SDK appends /v1/messages itself; the OpenAI ones take the /v1 root.
const ENDPOINT_HINTS: Record<string, string> = { 'anthropic-messages': 'https://gateway.example' };
const SHOWN_MODELS = 8;
// A failure in the interface language; the dialog's error line shows it.
const translated = <T,>(promise: Promise<T>): Promise<T> => Promise.resolve(promise).catch((failure: unknown) => { throw new Error(hostText((failure as {
    message?: string;
} | null)?.message ?? String(failure))); });
export function ProvidersPage({ actions, run, Section }: {
    actions: ProvidersActions;
    run: RunWork;
    Section: React.ComponentType<Record<string, unknown>>;
}) {
    const [view, setView] = useState<ProvidersView | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    // Resolves true when the host took it; the page then shows the host's new view.
    const apply: Apply = promise => run(translated(promise).then((next) => { if ((next as ProvidersView | undefined)?.providers)
        setView(next as ProvidersView); }));
    useEffect(() => { void apply(actions.providers()); }, []);
    if (view === null)
        return null;
    if (!view.available)
        return <p className='bt-set-hint'>{t('Model providers cannot be set up here.')}</p>;
    return [
        h(Section, { key: 'list', title: t('Model providers · {count}', { count: view.providers.length }) }, view.providers.map(provider => <ProviderRow key={provider.id} provider={provider} apply={apply} actions={actions} open={open === provider.id} onToggle={() => setOpen(open === provider.id ? null : provider.id)} />), adding ? <AddProvider key='add' view={view} apply={apply} actions={actions} onDone={() => setAdding(false)} /> : null),
        adding ? null : <div key='add' className='bt-actions'><button type='button' className='bt-soft bt-soft-sm' onClick={() => setAdding(true)}>{t('Add a provider')}</button></div>,
    ];
}
function keyState(key: Provider['key']): [
    string,
    string
] | null {
    if (key === null)
        return null;
    if (!key.configured)
        return ['missing', t('Needs an API key')];
    return key.writable ? ['set', t('Key set')] : ['outside', t('Key set outside Moon Bot')];
}
function ProviderRow({ provider, apply, actions, open, onToggle }: {
    provider: Provider;
    apply: Apply;
    actions: ProvidersActions;
    open: boolean;
    onToggle: () => void;
}) {
    const [confirm, setConfirm] = useState(false);
    useEffect(() => { if (!open)
        setConfirm(false); }, [open]);
    const state = keyState(provider.key);
    const shown = provider.models.slice(0, SHOWN_MODELS);
    const hint = provider.error ?? (provider.models.length === 0 ? t('No models') : t('{count} models', { count: provider.models.length }));
    return <div className='bt-secret-item bt-provider' data-open={open ? '' : undefined}><button type='button' className='bt-set-row bt-secret-summary' aria-expanded={open} onClick={onToggle}><span className='bt-set-copy'><span className='bt-secret-title'>{provider.name}{provider.name !== provider.id ? <span className='bt-provider-id'>{provider.id}</span> : null}</span><span className='bt-set-hint' data-error={provider.error ? '' : undefined}>{hint}</span></span>{state ? <span className='bt-set-control'><span className='bt-provider-state' data-state={state[0]}>{state[1]}</span></span> : null}</button>{open ? <div className='bt-secret-edit'>{provider.key?.writable ? <KeyEditor provider={provider} apply={apply} actions={actions} /> : null}{provider.key && !provider.key.writable ? <div className='bt-set-hint'>{t('This key comes from outside Moon Bot, such as an environment variable, and cannot be changed here.')}</div> : null}{provider.models.length > 0 ? <div className='bt-secret-edit-block'><div className='bt-secret-edit-label'>{t('Models')}</div><div className='bt-provider-models'>{shown.map(model => <span key={model.ref} className='bt-tag' title={model.ref}>{model.name}</span>)}{provider.models.length > shown.length ? <span className='bt-set-hint'>{t('and {count} more', { count: provider.models.length - shown.length })}</span> : null}</div></div> : null}{provider.removable ? <div className='bt-secret-row-actions'>{confirm
        ? [
            <span key='q' className='bt-set-hint'>{t('Remove {name}? Bots on its models need another model.', { name: provider.name })}</span>,
            <button key='no' type='button' className='bt-soft bt-soft-sm' onClick={() => setConfirm(false)}>{t('Keep')}</button>,
            <button key='yes' type='button' className='bt-soft bt-soft-sm bt-secret-danger' onClick={() => apply(actions.removeProvider(provider.id))}>{t('Remove')}</button>,
        ]
        : <button type='button' className='bt-soft bt-soft-sm bt-secret-danger' onClick={() => setConfirm(true)}><TrashIcon />{t('Remove provider')}</button>}</div> : null}</div> : null}</div>;
}
function KeyEditor({ provider, apply, actions }: {
    provider: Provider;
    apply: Apply;
    actions: ProvidersActions;
}) {
    const [value, setValue] = useState('');
    const [saved, setSaved] = useState(false);
    const ready = value.trim() !== '';
    const save = () => {
        if (!ready)
            return;
        void apply(actions.setProviderKey(provider.id, value)).then((ok) => { if (ok) {
            setValue('');
            setSaved(true);
        } });
    };
    const edit = (next: string) => { setValue(next); setSaved(false); };
    const label = t('{provider} API key', { provider: provider.name });
    return <div className='bt-secret-edit-block'><div className='bt-secret-edit-label'>{provider.key?.configured ? t('Replace the API key') : t('API key')}</div><div className='bt-secret-inline'><label className='bt-q-field bt-secret-field'><KeyIcon /><MaskedInput value={value} onChange={edit} onEnter={save} label={label} /></label><button type='button' className='bt-soft bt-soft-sm' disabled={!ready} onClick={save}>{t('Save')}</button>{provider.key?.configured ? <button type='button' className='bt-soft bt-soft-sm bt-secret-danger' onClick={() => void apply(actions.setProviderKey(provider.id, null))}>{t('Remove key')}</button> : null}</div>{saved ? <div className='bt-set-hint bt-secret-ok' role='status'><CheckIcon />{t('Saved.')}</div> : null}</div>;
}
function AddProvider({ view, apply, actions, onDone }: {
    view: ProvidersView;
    apply: Apply;
    actions: ProvidersActions;
    onDone: () => void;
}) {
    const [mode, setMode] = useState(view.addable.length > 0 ? 'known' : 'custom');
    return <div className='bt-set-row bt-set-paste bt-provider-add'><Segmented label={t('Kind of provider')} value={mode}>{([['known', t('Known provider')], ['custom', t('Custom API')]] as [
        string,
        string
    ][]).map(([id, label]) => <button key={id} type='button' aria-pressed={mode === id} disabled={id === 'known' && view.addable.length === 0} onClick={() => setMode(id)}>{label}</button>)}</Segmented><div hidden={mode !== 'known'}><KnownForm view={view} apply={apply} actions={actions} onDone={onDone} /></div><div hidden={mode !== 'custom'}><CustomForm view={view} apply={apply} actions={actions} onDone={onDone} /></div></div>;
}
function KnownForm({ view, apply, actions, onDone }: {
    view: ProvidersView;
    apply: Apply;
    actions: ProvidersActions;
    onDone: () => void;
}) {
    const [provider, setProvider] = useState('');
    const [key, setKey] = useState('');
    const options = [...view.addable].sort((a, b) => a.name.localeCompare(b.name));
    const add = () => {
        if (provider === '')
            return;
        void apply(actions.addProvider({ provider, key })).then((ok) => { if (ok)
            onDone(); });
    };
    return <div className='bt-provider-form'><select className='bt-select' aria-label={t('Provider')} value={provider} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setProvider(event.target.value)}><option value='' disabled>{t('Choose a provider')}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><label className='bt-q-field bt-secret-field'><KeyIcon /><MaskedInput value={key} onChange={setKey} onEnter={add} label={t('API key')} /></label><FormActions onCancel={onDone} onAdd={add} ready={provider !== ''} /></div>;
}
function CustomForm({ view, apply, actions, onDone }: {
    view: ProvidersView;
    apply: Apply;
    actions: ProvidersActions;
    onDone: () => void;
}) {
    const [draft, setDraft] = useState({ provider: '', name: '', baseURL: '', api: view.protocols[0] ?? '', key: '', typed: '' });
    const [found, setFound] = useState<readonly {
        id: string;
        name?: string;
    }[] | null>(null);
    const [picked, setPicked] = useState<string[]>([]);
    const [asking, setAsking] = useState(false);
    const set = (field: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [field]: field === 'baseURL' ? value.trim().replace(/\/chat\/completions\/?$/i, '') : value }));
    const typed = draft.typed.split(/[\s,]+/).map(id => id.trim()).filter(Boolean);
    const models = [...(found ?? []).filter(model => picked.includes(model.id)), ...typed.filter(id => !picked.includes(id)).map(id => ({ id }))];
    const ready = draft.provider.trim() !== '' && draft.baseURL.trim() !== '' && models.length > 0;
    const fetchModels = () => {
        setAsking(true);
        void apply(Promise.resolve(actions.providerModels({ baseURL: draft.baseURL, api: draft.api, key: draft.key })).then((list) => { setFound(list); setPicked([]); }))
            .finally(() => setAsking(false));
    };
    const toggle = (id: string) => setPicked(list => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]));
    const add = () => {
        if (!ready)
            return;
        void apply(actions.addProvider({ custom: true, provider: draft.provider.trim(), name: draft.name, baseURL: draft.baseURL, api: draft.api, key: draft.key, models }))
            .then((ok) => { if (ok)
            onDone(); });
    };
    const input = (field: keyof typeof draft, label: string, placeholder: string) => <input className='bt-input' aria-label={label} placeholder={placeholder} value={draft[field]} spellCheck={false} autoComplete='off' onChange={(event: React.ChangeEvent<HTMLInputElement>) => set(field, event.target.value)}/>;
    return <div className='bt-provider-form'><div className='bt-provider-pair'>{input('provider', t('Provider ID'), t('Provider ID, e.g. my-gateway'))}{input('name', t('Name'), t('Name (optional)'))}</div><div className='bt-provider-pair'>{input('baseURL', t('Endpoint'), ENDPOINT_HINTS[draft.api] ?? 'https://gateway.example/v1')}<select className='bt-select' aria-label={t('Protocol')} value={draft.api} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => set('api', event.target.value)}>{view.protocols.map(api => <option key={api} value={api}>{PROTOCOL_NAMES[api] ?? api}</option>)}</select></div><label className='bt-q-field bt-secret-field'><KeyIcon /><MaskedInput value={draft.key} onChange={(value: string) => set('key', value)} label={t('API key')} /></label><div className='bt-secret-edit-block'><div className='bt-provider-models-head'><span className='bt-secret-edit-label'>{t('Models')}</span><button type='button' className='bt-soft bt-soft-sm' disabled={asking || draft.baseURL.trim() === ''} onClick={fetchModels}>{asking ? t('Asking…') : t('Fetch models')}</button></div>{found !== null && found.length === 0 ? <div className='bt-set-hint'>{t('The endpoint lists no models. Enter their ids below.')}</div> : null}{found !== null && found.length > 0 ? <div className='bt-secret-bots bt-provider-found'>{found.map(model => <button key={model.id} type='button' className='bt-secret-bot' aria-pressed={picked.includes(model.id)} title={model.name && model.name !== model.id ? model.name : undefined} onClick={() => toggle(model.id)}><code>{model.id}</code>{picked.includes(model.id) ? <CheckIcon /> : null}</button>)}</div> : null}{input('typed', t('Model ids'), t('Model ids, separated by commas'))}</div><FormActions onCancel={onDone} onAdd={add} ready={ready} /></div>;
}
function FormActions({ onCancel, onAdd, ready }: {
    onCancel: () => void;
    onAdd: () => void;
    ready: boolean;
}) {
    return <div className='bt-secret-row-actions'><button type='button' className='bt-soft bt-soft-sm' onClick={onCancel}>{t('Cancel')}</button><button type='button' className='bt-soft bt-soft-sm' disabled={!ready} onClick={onAdd}>{t('Add')}</button></div>;
}
export const PROVIDERS_CSS = `
.bt-provider-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--bt-ink-3)}
.bt-provider .bt-set-hint[data-error]{color:var(--bt-danger)}
.bt-provider-state{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:16px;color:var(--bt-ink-2);white-space:nowrap}
.bt-provider-state::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--bt-ink-3)}
.bt-provider-state[data-state=set]::before{background:var(--bt-green)}
.bt-provider-state[data-state=missing]{color:var(--bt-danger)}
.bt-provider-state[data-state=missing]::before{background:var(--bt-danger)}
.bt-provider .bt-secret-field{align-items:center;gap:8px}
.bt-provider .bt-secret-field>svg,.bt-provider-form .bt-secret-field>svg{flex:none;color:var(--bt-ink-3)}
.bt-provider-models{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.bt-provider-models .bt-tag{max-width:220px}
.bt-provider-add{gap:12px;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
.bt-provider-add .bt-seg{align-self:flex-start}
.bt-provider-add .bt-seg button{flex:none;padding:0 14px;white-space:nowrap}
.bt-provider-add .bt-seg button:disabled{opacity:.45;cursor:default}
.bt-provider-form{display:flex;flex-direction:column;gap:10px}
.bt-provider-form .bt-secret-field{min-height:36px;align-items:center;gap:8px}
.bt-provider-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bt-provider-models-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-provider-found{max-height:180px;overflow-y:auto;scrollbar-width:thin}
.bt-provider-found code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.bt-provider-found .bt-secret-bot{padding:0 10px}
@media (prefers-reduced-motion:reduce){.bt-provider-add{animation:none}}
`;
