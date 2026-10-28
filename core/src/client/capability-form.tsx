// The capability editor: a guided form whose fields mirror the host's rules, with the
// JSON maps as text until submit and an error under the field that has one.
import { createElement as h, useState } from 'react';
import { t } from './i18n.ts';
import { draftErrors, payloadOf, transportOf, type CapabilityDraft, type DraftErrors } from './capability-draft.ts';
import type { Capability, CapabilityActions } from './capability-types.ts';

function Field({ label, value, onChange, onBlur, multiline = false, disabled = false, placeholder, error, hint }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onBlur?: (() => void) | undefined;
    multiline?: boolean;
    disabled?: boolean;
    placeholder?: string;
    error?: string | undefined;
    hint?: string | undefined;
}) {
    return <label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span>{hint ? <span className='bt-set-hint'>{hint}</span> : null}</span>{h(multiline ? 'textarea' : 'input', {
        className: error ? 'bt-input bt-input-error' : 'bt-input',
        value,
        disabled,
        placeholder,
        spellCheck: false,
        'aria-invalid': error !== undefined,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
        onBlur,
    })}{error ? <span className='bt-field-error' role='alert'>{error}</span> : null}</label>;
}

function Select({ label, value, options, onChange }: {
    label: string;
    value: string;
    options: readonly (readonly [string, string])[];
    onChange: (value: string) => void;
}) {
    return <label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span></span><select className='bt-input' value={value} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

export function CapabilityForm({ draft, setDraft, items, actions, onClose }: {
    draft: CapabilityDraft;
    setDraft: React.Dispatch<React.SetStateAction<CapabilityDraft | null>>;
    items: readonly Capability[];
    actions: CapabilityActions;
    onClose: () => void;
}) {
    const [attempted, setAttempted] = useState(false);
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState(false);
    const [serverError, setServerError] = useState('');
    const errors = draftErrors(draft, items);
    const set = <K extends keyof CapabilityDraft>(key: K, value: CapabilityDraft[K]): void => {
        setDraft(previous => (previous === null ? null : ({ ...previous, [key]: value } as CapabilityDraft)));
    };
    const touch = (field: keyof DraftErrors): void => { setTouched(previous => (previous[field] ? previous : { ...previous, [field]: true })); };
    const errorOf = (field: keyof DraftErrors): string | undefined => (attempted || touched[field] === true) && errors[field] !== undefined ? t(errors[field] as string) : undefined;
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setAttempted(true);
        setServerError('');
        if (Object.keys(errors).length > 0)
            return;
        setBusy(true);
        try {
            await actions.saveCapability(payloadOf(draft));
            onClose();
        }
        catch (failure) {
            setServerError((failure as { message?: string } | null)?.message ?? String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    const available = items.filter(item => item.name !== draft.originalName && ['mcp', 'skill'].includes(item.kind));
    const transport = transportOf(draft);
    return <form className='bt-connector-form bt-cap-form' onSubmit={submit}>
        <div className='bt-cap-form-title'>{draft.originalName ? t('Edit {name}', { name: draft.originalName }) : t('New capability')}</div>
        <Field label={t('Name')} value={draft.name} disabled={draft.originalName !== undefined} onBlur={() => touch('name')} onChange={value => set('name', value)} placeholder={t('my-tool')} hint={draft.originalName ? undefined : t('Lowercase letters, digits, and single hyphens.')} error={errorOf('name')} />
        <Select label={t('Type')} value={draft.kind} options={[['mcp', t('MCP server')], ['skill', t('Skill')], ['pack', t('Pack')]]} onChange={value => set('kind', value)} />
        <Field label={t('Description')} value={draft.description} onChange={value => set('description', value)} placeholder={t('What this capability does')} />
        {draft.kind === 'mcp' ? <Select label={t('Connection')} value={transport} options={[['stdio', t('Local command (stdio)')], ['streamable-http', t('HTTP server (streamable HTTP)')], ['sse', t('SSE endpoint (legacy)')]]} onChange={value => set('transport', value)} /> : null}
        {draft.kind === 'mcp' && transport === 'stdio' ? <div className='bt-cap-form-fields'>
            <Field label={t('Command')} value={draft.command} onBlur={() => touch('command')} onChange={value => set('command', value)} placeholder={t('npx -y any-mcp-server')} error={errorOf('command')} />
            <Field label={t('Arguments (one per line)')} value={draft.argsText} onChange={value => set('argsText', value)} multiline />
            <Field label={t('Environment (JSON)')} value={draft.envText} onBlur={() => touch('envText')} onChange={value => set('envText', value)} multiline placeholder={t('{"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}')} error={errorOf('envText')} />
        </div> : null}
        {draft.kind === 'mcp' && transport !== 'stdio' ? <div className='bt-cap-form-fields'>
            <Field label={t('URL')} value={draft.url} onBlur={() => touch('url')} onChange={value => set('url', value)} placeholder={transport === 'sse' ? 'https://mcp.example.com/sse' : 'https://mcp.example.com/mcp'} error={errorOf('url')} />
            <Field label={t('Headers (JSON)')} value={draft.headersText} onBlur={() => touch('headersText')} onChange={value => set('headersText', value)} multiline placeholder={t('{"API_KEY": "$MOON_BOT_SECRET_MY_KEY"}')} error={errorOf('headersText')} />
        </div> : null}
        {draft.kind === 'skill' ? <Field label={t('Skill instructions')} value={draft.content} onBlur={() => touch('content')} onChange={value => set('content', value)} multiline error={errorOf('content')} /> : null}
        {draft.kind === 'pack' ? <div className='bt-set-card'>{available.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Save an MCP server or skill first.')}</span></div> : available.map(item => <label key={item.name} className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{item.name}</span><span className='bt-set-hint'>{item.description || item.kind}</span></span><input type='checkbox' checked={draft.items.includes(item.name)} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('items', event.target.checked ? [...draft.items, item.name] : draft.items.filter(name => name !== item.name))}/></label>)}</div> : null}
        {serverError ? <div className='bt-connector-error' role='alert'>{serverError}</div> : null}
        <div className='bt-connector-form-row'>
            <button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onClose}>{t('Cancel')}</button>
            <button type='submit' className='bt-soft bt-soft-sm' disabled={busy}>{busy ? t('Saving…') : draft.originalName ? t('Save changes') : t('Add capability')}</button>
        </div>
    </form>;
}
