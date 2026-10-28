import { createElement as h, useEffect, useState } from 'react';
import { t } from './i18n.ts';
// A capability as the host reports it: an MCP server, a skill or a pack of them.
export interface Capability {
    name: string;
    kind: string;
    description?: string;
    transport?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    content?: string;
    items?: string[];
    approved?: boolean;
}
// The form's own shape: every field is a string in the inputs, and the JSON ones stay
// text until the form is sent.
interface CapabilityDraft {
    name: string;
    kind: string;
    description: string;
    transport: string;
    command: string;
    argsText: string;
    envText: string;
    url: string;
    headersText: string;
    content: string;
    items: string[];
    originalName?: string | undefined;
}
interface CapabilityStatus {
    state: string;
    error?: string;
}
export interface CapabilityActions {
    saveCapability: (payload: Record<string, unknown>) => Promise<unknown>;
    deleteCapability: (name: string) => Promise<unknown>;
    approveCapability: (name: string) => Promise<unknown>;
    setBotCapability: (botId: string, name: string, attached: boolean) => Promise<unknown>;
}
export type RunWork = (work: Promise<unknown>) => unknown;
const blank = (): CapabilityDraft => ({ name: '', kind: 'mcp', description: '', transport: 'stdio', command: '', argsText: '', envText: '{}', url: '', headersText: '{}', content: '', items: [] });
const parseMap = (text: string, label: string): Record<string, unknown> => {
    let value;
    try {
        value = JSON.parse(text || '{}');
    }
    catch {
        throw new Error(t('{label} must be valid JSON.', { label }));
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(t('{label} must be a JSON object.', { label }));
    return value;
};
const statusText = (status: CapabilityStatus | undefined): string | undefined => !status ? undefined : status.state === 'ready' ? t('Ready')
    : status.state === 'needs-approval' ? t('Needs approval')
        : status.state === 'error' ? t('Could not connect: {error}', { error: status.error ?? '' })
            : t('Connecting…');
function Field({ label, value, onChange, multiline = false, disabled = false, placeholder }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    multiline?: boolean;
    disabled?: boolean;
    placeholder?: string;
}) {
    return <label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{t(label)}</span></span>{h(multiline ? 'textarea' : 'input', {
        className: multiline ? 'bt-input bt-input-area' : 'bt-input',
        value,
        disabled,
        maxLength: label === 'Name' ? 32 : undefined,
        placeholder,
        spellCheck: false,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    })}</label>;
}
function CapabilityForm({ draft, setDraft, items, actions, onClose }: {
    draft: CapabilityDraft;
    setDraft: React.Dispatch<React.SetStateAction<CapabilityDraft | null>>;
    items: Capability[];
    actions: CapabilityActions;
    onClose: () => void;
}) {
    const [error, setError] = useState('');
    const set = <K extends keyof CapabilityDraft>(key: K, value: CapabilityDraft[K]): void => {
        setDraft(previous => (previous === null ? null : ({ ...previous, [key]: value } as CapabilityDraft)));
    };
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        let payload: Record<string, unknown>;
        try {
            payload = { name: draft.name.trim(), kind: draft.kind, description: draft.description };
            if (draft.kind === 'mcp' && draft.transport === 'stdio') {
                payload.transport = 'stdio';
                payload.command = draft.command;
                payload.args = draft.argsText.split('\n').filter(line => line !== '');
                payload.env = parseMap(draft.envText, t('Environment'));
            }
            else if (draft.kind === 'mcp') {
                payload.transport = 'streamable-http';
                payload.url = draft.url;
                payload.headers = parseMap(draft.headersText, t('Headers'));
            }
            else if (draft.kind === 'skill')
                payload.content = draft.content;
            else
                payload.items = draft.items;
        }
        catch (failure) {
            setError((failure as {
                message?: string;
            } | null)?.message ?? String(failure));
            return;
        }
        try {
            await actions.saveCapability(payload);
            onClose();
        }
        catch (failure) {
            setError((failure as {
                message?: string;
            } | null)?.message ?? String(failure));
        }
    };
    const available = items.filter(item => item.name !== draft.name && ['mcp', 'skill'].includes(item.kind));
    return <form className='bt-connector-form' onSubmit={submit}><Field label='Name' value={draft.name} disabled={draft.originalName !== undefined} onChange={value => set('name', value)} placeholder='my-tool' /><label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Type')}</span></span><select className='bt-input' value={draft.kind} disabled={draft.originalName !== undefined} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => set('kind', event.target.value)}>{['mcp', 'skill', 'pack'].map(kind => <option key={kind} value={kind}>{t(kind === 'mcp' ? 'MCP server' : kind === 'skill' ? 'Skill' : 'Pack')}</option>)}</select></label><Field label='Description' value={draft.description} onChange={value => set('description', value)} />{draft.kind === 'mcp' ? <label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Connection')}</span></span><select className='bt-input' value={draft.transport} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => set('transport', event.target.value)}><option value='stdio'>{t('Local command')}</option><option value='streamable-http'>{t('HTTP server')}</option></select></label> : null}{draft.kind === 'mcp' && draft.transport === 'stdio' ? <div><Field label='Command' value={draft.command} onChange={value => set('command', value)} /><Field label='Arguments (one per line)' value={draft.argsText} onChange={value => set('argsText', value)} multiline /><Field label='Environment (JSON)' value={draft.envText} onChange={value => set('envText', value)} multiline placeholder={t('{"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}')} /></div> : null}{draft.kind === 'mcp' && draft.transport === 'streamable-http' ? <div><Field label='URL' value={draft.url} onChange={value => set('url', value)} /><Field label='Headers (JSON)' value={draft.headersText} onChange={value => set('headersText', value)} multiline placeholder={t('{"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}')} /></div> : null}{draft.kind === 'skill' ? <Field label='Skill instructions' value={draft.content} onChange={value => set('content', value)} multiline /> : null}{draft.kind === 'pack' ? <div className='bt-set-card'>{available.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Save an MCP server or skill first.')}</span></div> : available.map(item => <label key={item.name} className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{item.name}</span></span><input type='checkbox' checked={draft.items.includes(item.name)} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('items', event.target.checked ? [...draft.items, item.name] : draft.items.filter(name => name !== item.name))}/></label>)}</div> : null}{error ? <div className='bt-connector-error' role='alert'>{error}</div> : null}<div className='bt-connector-form-row'><button type='button' className='bt-soft bt-soft-sm' onClick={onClose}>{t('Cancel')}</button><button type='submit' className='bt-soft bt-soft-sm'>{draft.originalName ? t('Save changes') : t('Add capability')}</button></div></form>;
}
function CapabilityRow({ item, onEdit, onDelete, onApprove, confirming }: {
    item: Capability;
    onEdit: () => void;
    onDelete: () => void;
    onApprove: () => void;
    confirming: boolean;
}) {
    const detail = item.kind === 'pack' ? `${t('Pack')}: ${(item.items ?? []).join(', ') || t('No items')}`
        : item.kind === 'mcp' ? item.transport === 'stdio' ? t('Local command') : t('HTTP server')
            : t('Skill');
    const secondary = item.kind === 'pack'
        ? [item.description, (item.items ?? []).join(', ') || t('No items')].filter(Boolean).join(' · ')
        : item.description || detail;
    return <div className='bt-connector'><div className='bt-connector-head'><span className='bt-connector-text'><span className='bt-connector-name'>{item.name}</span><span className='bt-connector-status'>{secondary}</span></span><span className='bt-connector-actions'>{item.kind === 'mcp' && item.transport === 'stdio' && !item.approved
        ? <button type='button' className='bt-soft bt-soft-sm' onClick={onApprove}>{t('Allow')}</button> : null}<button type='button' className='bt-soft bt-soft-sm' onClick={onEdit}>{t('Edit')}</button><button type='button' className='bt-soft bt-soft-sm' onClick={onDelete}>{confirming ? t('Click again to delete.') : t('Delete')}</button></span></div></div>;
}
export function CapabilitiesPage({ roster, actions, run }: {
    roster: {
        capabilities?: Capability[];
    };
    actions: CapabilityActions;
    run: RunWork;
}) {
    const items = [...(roster.capabilities ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const [draft, setDraft] = useState<CapabilityDraft | null>(null);
    const [confirming, setConfirming] = useState('');
    useEffect(() => {
        if (!confirming)
            return undefined;
        const timer = setTimeout(() => setConfirming(''), 4000);
        return () => clearTimeout(timer);
    }, [confirming]);
    const startNew = () => setDraft(blank());
    const edit = (item: Capability) => setDraft({
        ...blank(),
        ...(item as Partial<CapabilityDraft>),
        originalName: item.name,
        argsText: (item.args ?? []).join('\n'),
        envText: JSON.stringify(item.env ?? {}, null, 2),
        headersText: JSON.stringify(item.headers ?? {}, null, 2),
        items: [...(item.items ?? [])],
    });
    const remove = (item: Capability) => {
        if (confirming !== item.name) {
            setConfirming(item.name);
            return;
        }
        setConfirming('');
        void run(actions.deleteCapability(item.name));
    };
    return <section className='bt-set-section'><h3>{t('Shared capabilities')}</h3><div className='bt-actions'><button type='button' className='bt-soft bt-soft-sm' onClick={startNew}>{t('Add capability')}</button></div>{draft ? <CapabilityForm draft={draft} setDraft={setDraft} items={items} actions={actions} onClose={() => setDraft(null)} /> : null}<div className='bt-set-card bt-connectors-card'>{items.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('No capabilities saved')}</span></div> : items.map(item => <CapabilityRow key={item.name} item={item} confirming={confirming === item.name} onEdit={() => edit(item)} onDelete={() => remove(item)} onApprove={() => void run(actions.approveCapability(item.name))} />)}</div></section>;
}
export function BotCapabilitiesCard({ bot, roster, actions, run, Card, SwitchRow }: {
    bot: {
        id: string;
        capabilities?: string[];
    };
    roster: {
        capabilities?: Capability[];
        capabilityStatuses?: Record<string, Record<string, CapabilityStatus | undefined>>;
    };
    actions: CapabilityActions;
    run: RunWork;
    Card: React.ComponentType<Record<string, unknown>>;
    SwitchRow: React.ComponentType<Record<string, unknown>>;
}) {
    const items = [...(roster.capabilities ?? [])].sort((a, b) => Number(b.kind === 'pack') - Number(a.kind === 'pack') || a.name.localeCompare(b.name));
    const attached = new Set(bot.capabilities ?? []);
    const statuses = roster.capabilityStatuses?.[bot.id] ?? {};
    if (items.length === 0)
        return null;
    return h(Card, { title: t('Capabilities') }, items.map(item => h(SwitchRow, {
        key: item.name,
        label: item.name,
        hint: attached.has(item.name) ? statusText(statuses[item.name]) : undefined,
        on: attached.has(item.name),
        onChange: (enabled: boolean) => void run(actions.setBotCapability(bot.id, item.name, enabled)),
    })));
}
