// Custom connectors are capabilities the user typed: a guided editor with a connection
// test before saving, and a list that shows what the last connect did and lets one retry,
// turn it off everywhere, or delete it after an explicit confirmation.
import { createElement as h, Fragment, useState } from 'react';
import { t } from './i18n.ts';
import { CheckIcon, PlusIcon } from './icons.tsx';
import { DefaultConnectorLogo } from './connector-logos.tsx';
import { healthOf, toolsOf } from './capability-library.ts';
import type { Capability, CapabilityBot, CapabilityStatus } from './capability-types.ts';
import { Field } from 'moon-bot-ui';
import { blankCustomConnector, commandParts, connectorIdOf, customCapabilityOf, customConnectorErrors, customTestOf, draftFromConnector, type CustomConnectorDraft, type CustomConnectorErrors, type CustomTransport } from './connector-custom.ts';

export interface CustomConnectorActions {
    saveCapability: (payload: Record<string, unknown>) => Promise<unknown>;
    deleteCapability: (name: string) => Promise<unknown>;
    setBotCapability: (botId: string, name: string, attached: boolean) => Promise<unknown>;
    retryCapability: (name: string) => Promise<unknown>;
    testCapability: (payload: Record<string, unknown>) => Promise<{ readonly tools: readonly string[]; readonly ms: number }>;
}

export function CustomConnectorForm({ initial, market, existing, onClose }: {
    initial?: CustomConnectorDraft | undefined;
    market: CustomConnectorActions;
    existing: readonly Capability[];
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<CustomConnectorDraft>(initial ?? blankCustomConnector());
    const [attempted, setAttempted] = useState(false);
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);
    const [serverError, setServerError] = useState('');
    const [test, setTest] = useState<{ ok: boolean; text: string; tools: readonly string[]; signature: string } | null>(null);
    const errors = customConnectorErrors(draft, existing);
    const id = connectorIdOf(draft.name);
    const set = <K extends keyof CustomConnectorDraft>(key: K, value: CustomConnectorDraft[K]): void => { setDraft(previous => ({ ...previous, [key]: value })); };
    const touch = (field: keyof CustomConnectorErrors): void => { setTouched(previous => (previous[field] ? previous : { ...previous, [field]: true })); };
    const errorOf = (field: keyof CustomConnectorErrors): string | undefined => (attempted || touched[field] === true) && errors[field] !== undefined ? t(errors[field] as string) : undefined;
    const ready = Object.keys(errors).length === 0;
    const signature = JSON.stringify(customTestOf(draft));
    const stale = test !== null && test.signature !== signature;
    const testNow = async (): Promise<void> => {
        setAttempted(true);
        if (!ready)
            return;
        setTesting(true);
        setTest(null);
        setServerError('');
        try {
            const result = await market.testCapability(customTestOf(draft));
            setTest({ ok: true, text: result.tools.length === 0 ? t('Connected. The server offers no tools.') : t('Connected. {count} tools found.', { count: result.tools.length }), tools: result.tools, signature });
        }
        catch (failure) {
            setTest({ ok: false, text: (failure as { message?: string } | null)?.message ?? String(failure), tools: [], signature });
        }
        finally {
            setTesting(false);
        }
    };
    const submit = async (event: React.FormEvent): Promise<void> => {
        event.preventDefault();
        setAttempted(true);
        setServerError('');
        if (!ready)
            return;
        setBusy(true);
        try {
            await market.saveCapability(customCapabilityOf(draft));
            onClose();
        }
        catch (failure) {
            setServerError((failure as { message?: string } | null)?.message ?? String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    return <form className='bt-market-form bt-custom-form' onSubmit={event => { void submit(event); }}>
        <div className='bt-market-form-head'>
            <div className='bt-market-form-title-row'>
                <span className='bt-market-icon bt-market-form-icon'><DefaultConnectorLogo size={28} /></span>
                <div className='bt-market-form-info'>
                    <span className='bt-market-name'>{draft.originalName ? t('Edit {name}', { name: draft.originalName }) : t('Custom MCP server')}</span>
                    <span className='bt-market-desc'>{draft.originalName ? t('Change everything except the name. The Bot reconnects on its next turn.') : t('Connect any community or custom MCP server by command or URL.')}</span>
                </div>
            </div>
        </div>
        <Field layout='compact' label={t('Name')} value={draft.name} disabled={draft.originalName !== undefined} onChange={value => set('name', value)} onBlur={() => touch('name')} error={errorOf('name')} placeholder='my-custom-tool' hint={draft.originalName === undefined && id !== '' && id !== draft.name.trim() ? t('Saved as {name}', { name: id }) : undefined} />
        <label className='bt-q-field bt-secret-field'>
            <span className='bt-set-hint'>{t('Type')}</span>
            <select className='bt-input' value={draft.transport} onChange={event => set('transport', event.target.value as CustomTransport)} aria-label={t('Type')}>
                <option value='stdio'>{t('Local command (stdio)')}</option>
                <option value='streamable-http'>{t('HTTP server (streamable HTTP)')}</option>
                <option value='sse'>{t('SSE endpoint (legacy)')}</option>
            </select>
        </label>
        {draft.transport === 'stdio' ? <>
            <Field layout='compact' label={t('Command')} value={draft.command} onChange={value => set('command', value)} onBlur={() => touch('command')} error={errorOf('command')} placeholder='npx -y any-mcp-server' />
            <Field layout='compact' label={t('Arguments (one per line)')} value={draft.argsText} onChange={value => set('argsText', value)} placeholder={t('--flag')} />
            <Field layout='compact' label={t('Environment (JSON)')} value={draft.envText} onChange={value => set('envText', value)} onBlur={() => touch('envText')} error={errorOf('envText')} multiline />
        </> : <>
            <Field layout='compact' label={t('URL')} value={draft.url} onChange={value => set('url', value)} onBlur={() => touch('url')} error={errorOf('url')} placeholder={draft.transport === 'sse' ? 'https://mcp.example.com/sse' : 'https://mcp.example.com/mcp'} />
            <Field layout='compact' label={t('Headers (JSON)')} value={draft.headersText} onChange={value => set('headersText', value)} onBlur={() => touch('headersText')} error={errorOf('headersText')} multiline />
        </>}
        <Field layout='compact' label={t('Description')} value={draft.description} onChange={value => set('description', value)} placeholder={t('What this tool does')} />
        {draft.transport === 'stdio' && draft.command.trim() !== '' ? <span className='bt-set-hint'>{t('Runs {command}. Moon Bot asks before a local command first starts.', { command: commandParts(draft.command).command })}</span> : null}
        {test !== null ? <div className='bt-cap-notice' data-tone={test.ok ? 'ready' : 'error'} role='status'><span>{test.ok ? <span className='bt-cap-ok'><CheckIcon />{test.text}</span> : test.text}</span>{test.ok && test.tools.length > 0 ? <code className='bt-cap-test-tools'>{test.tools.slice(0, 3).join(', ')}{test.tools.length > 3 ? '…' : ''}</code> : null}</div> : null}
        {stale ? <span className='bt-set-hint'>{t('The fields changed since the last test. Test again before saving if you want the result to count.')}</span> : null}
        {serverError ? <div className='bt-connector-error' role='alert'>{serverError}</div> : null}
        <div className='bt-connector-form-row bt-custom-actions'>
            <button type='button' className='bt-soft bt-soft-sm' disabled={busy || testing} onClick={onClose}>{t('Cancel')}</button>
            <button type='button' className='bt-soft bt-soft-sm' disabled={busy || testing || !ready} onClick={() => { void testNow(); }}>{testing ? t('Testing…') : t('Test connection')}</button>
            <button type='submit' className='bt-soft bt-soft-sm' disabled={busy || testing}>{busy ? t('Saving…') : draft.originalName ? t('Save changes') : t('Add connector')}</button>
        </div>
    </form>;
}

export function customConnectorDraftOf(item: Capability): CustomConnectorDraft {
    return draftFromConnector(item);
}

export function CustomConnectorList({ items, bots, statuses, tools, confirming, busy, onEdit, onDelete, onCancelDelete, onRetry, onTurnOff }: {
    items: readonly Capability[];
    bots: readonly CapabilityBot[];
    statuses: Readonly<Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>> | undefined;
    tools: Readonly<Record<string, readonly string[]>> | undefined;
    confirming: string;
    busy: string;
    onEdit: (item: Capability) => void;
    onDelete: (item: Capability) => void;
    onCancelDelete: () => void;
    onRetry: (item: Capability) => void;
    onTurnOff: (item: Capability, using: readonly CapabilityBot[]) => void;
}) {
    return <div className='bt-set-card bt-connectors-card'>{items.map(item => {
        const health = healthOf(item, bots, statuses);
        const names = toolsOf(item, tools);
        const label = health.state === 'error' ? t('Failed') : health.state === 'ready' ? t('Connected') : health.state === 'connecting' ? t('Connecting…') : health.state === 'enabled' ? t('Enabled') : t('Not enabled');
        const detail = health.state === 'error' ? t('Last attempt failed: {error}', { error: health.error ?? '' }) : health.state === 'ready' ? t('Connected for {name} · {count} tools', { name: health.botName ?? '', count: names.length }) : health.state === 'enabled' ? t('Enabled; it connects on the Bot’s next turn.') : health.state === 'off' ? t('Not enabled for any Bot.') : t('Connecting to the server…');
        return <div key={item.name} className='bt-cap-row' data-state={health.state}>
            <div className='bt-cap-summary bt-custom-summary'>
                <span className='bt-connector-mark'><DefaultConnectorLogo size={22} /></span>
                <span className='bt-connector-text'><span className='bt-connector-name'>{item.name}</span><span className='bt-connector-status'>{item.description || detail}</span></span>
                <span className='bt-cap-chips'><span className='bt-cap-chip' data-tone={health.state === 'error' ? 'error' : health.state === 'ready' ? 'ready' : 'quiet'}>{label}</span><span className='bt-cap-chip'>{item.transport === 'stdio' ? t('Local') : item.transport === 'sse' ? t('SSE') : t('Cloud')}</span></span>
            </div>
            {health.state === 'error' ? <div className='bt-cap-notice' data-tone='error' role='alert'><span>{detail}</span></div> : <div className='bt-set-hint bt-custom-detail'>{detail}</div>}
            {confirming === item.name ? <div className='bt-cap-confirm' role='alert'>
                <span className='bt-cap-confirm-copy'>{t('Delete {name}? It is removed from {count} Bots, its tools stop working, and saved keys stay. This cannot be undone.', { name: item.name, count: health.using.length })}</span>
                <div className='bt-connector-form-row'>
                    <button type='button' className='bt-soft bt-soft-sm' disabled={busy === item.name} onClick={onCancelDelete}>{t('Cancel')}</button>
                    <button type='button' className='bt-soft bt-soft-sm bt-danger-soft' disabled={busy === item.name} onClick={() => onDelete(item)}>{busy === item.name ? t('Deleting…') : t('Delete')}</button>
                </div>
            </div> : <div className='bt-connector-form-row bt-cap-actions'>
                <button type='button' className='bt-soft bt-soft-sm' onClick={() => onEdit(item)}>{t('Edit')}</button>
                {health.state === 'error' ? <button type='button' className='bt-soft bt-soft-sm' disabled={busy === item.name} onClick={() => onRetry(item)}>{busy === item.name ? t('Retrying…') : t('Try again')}</button> : null}
                {health.using.length > 0 ? <button type='button' className='bt-soft bt-soft-sm' disabled={busy === item.name} onClick={() => onTurnOff(item, health.using)}>{t('Turn off for all Bots')}</button> : null}
                <button type='button' className='bt-soft bt-soft-sm bt-danger-soft' disabled={busy === item.name} onClick={() => onDelete(item)}>{t('Delete')}</button>
            </div>}
        </div>;
    })}</div>;
}

export function AddCustomConnector({ onAdd }: { onAdd: () => void }) {
    return <button type='button' className='bt-soft bt-soft-sm bt-market-custom-btn' onClick={onAdd}><PlusIcon /><span>{t('Custom MCP')}</span></button>;
}
