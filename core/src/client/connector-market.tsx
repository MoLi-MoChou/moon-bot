import { createElement as h, useState } from 'react';
import { spring, SPRING_TAP } from './motion.tsx';
import { MaskedInput } from './secret-card.tsx';
import { t } from './i18n.ts';
import { CONNECTOR_CATALOG, capabilityOf, type ConnectorCatalogEntry } from '../shared/connector-catalog.ts';
// The connector market (2026-10-27 connector-market): the curated MCP catalog as the
// Connectors page shows it. Installing an entry writes the secrets it names (as
// $MOON_BOT_SECRET_ references, so nothing secret ever sits in the capability config)
// and saves the capability item — from there the capability system's own rules run
// unchanged: a local command still needs the user's approval, and every mounted tool
// passes the same policy gate.
export interface MarketActions {
    secretSet: (payload: { name: string, value: string, purpose: string }) => Promise<unknown>;
    saveCapability: (item: Record<string, unknown>) => Promise<unknown>;
}

const CATEGORY_LABELS: Record<string, () => string> = {
    dev: () => t('Development'),
    web: () => t('Web'),
    docs: () => t('Docs'),
    memory: () => t('Memory'),
};

function CatalogCard({ entry, onInstall }: { entry: ConnectorCatalogEntry; onInstall: () => void }) {
    return <button type='button' className='bt-market-card' onClick={onInstall}><span className='bt-market-copy'><span className='bt-market-name'>{entry.name}</span><span className='bt-market-desc'>{t(entry.description)}</span></span><span className='bt-market-meta'><span className='bt-market-cat'>{CATEGORY_LABELS[entry.category]?.() ?? entry.category}</span><span className='bt-market-kind'>{entry.transport === 'stdio' ? t('Runs locally') : t('Hosted service')}</span></span></button>;
}

function InstallForm({ entry, market, onClose }: { entry: ConnectorCatalogEntry; market: MarketActions; onClose: () => void }) {
    const required = (entry.secrets ?? []).filter(secret => secret.optional !== true);
    const [values, setValues] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const install = (): void => {
        if (busy || required.some(secret => (values[secret.name] ?? '').trim() === ''))
            return;
        setBusy(true);
        setError(null);
        const secrets = (entry.secrets ?? []).filter(secret => (values[secret.name] ?? '').trim() !== '')
        void Promise.all(secrets.map(secret => market.secretSet({ name: secret.name, value: values[secret.name] ?? '', purpose: `${entry.name} connector` })))
            .then(() => market.saveCapability(capabilityOf(entry)))
            .then(onClose, failure => setError(failure?.message ?? String(failure)))
            .finally(() => setBusy(false));
    };
    return <div className='bt-market-form'><div className='bt-market-form-head'><span className='bt-market-name'>{entry.name}</span><span className='bt-market-desc'>{t(entry.description)}</span></div>{(entry.secrets ?? []).length > 0 ? (entry.secrets ?? []).map(secret => <label key={secret.name} className='bt-q-field bt-secret-field'>{h(MaskedInput, {
        value: values[secret.name] ?? '',
        onChange: next => setValues(last => ({ ...last, [secret.name]: next })),
        onEnter: install,
        label: t(secret.label) + (secret.optional === true ? t(' (optional)') : ''),
        autoFocus: secret === required[0],
    })}{secret.url !== undefined ? <a className='bt-connector-link' href={secret.url} target='_blank' rel='noopener noreferrer'>{t('Get it here')}</a> : null}</label>) : <div className='bt-set-hint'>{entry.transport === 'stdio' ? t('Runs a local command; Moon Bot asks before it first starts.') : t('Connects to the service over HTTPS.')}</div>}<div className='bt-connector-form-row'><button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type='button' className='bt-soft bt-soft-sm' disabled={busy || required.some(secret => (values[secret.name] ?? '').trim() === '')} onClick={install}>{busy ? t('Installing…') : t('Install')}</button></div>{error ? <div className='bt-connector-error' role='alert'>{error}</div> : null}</div>;
}

export function ConnectorCatalog({ market }: { market: MarketActions }) {
    const [installing, setInstalling] = useState<ConnectorCatalogEntry | null>(null);
    return <div className='bt-market'><h3 className='bt-market-title'>{t('Connector market')}</h3><p className='bt-market-note'>{t('One click adds the MCP service as a capability every Bot can use.')}</p>{installing !== null
        ? h(InstallForm, { key: installing.id, entry: installing, market, onClose: () => setInstalling(null) })
        : <div className='bt-market-grid'>{CONNECTOR_CATALOG.map(entry => h(CatalogCard, { key: entry.id, entry, onInstall: () => setInstalling(entry) }))}</div>}</div>;
}

export const MARKET_CSS = `
.bt-market{display:flex;flex-direction:column;gap:8px;padding:14px 16px}
.bt-market-title{margin:0;font-size:14px;line-height:20px}
.bt-market-note{margin:0 0 4px;font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-market-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.bt-market-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:84px;padding:10px 12px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-main);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:background-color .12s ease,${spring(SPRING_TAP, 'transform')}}
.bt-market-card:hover{background:var(--bt-hover);transform:translateY(-1px)}
.bt-market-card:active{transform:translateY(0)}
.bt-market-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.bt-market-name{font-size:13px;line-height:18px;font-weight:600}
.bt-market-desc{font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-market-meta{margin-top:auto;display:flex;gap:6px;align-items:center}
.bt-market-cat{font-size:11px;line-height:14px;padding:1px 7px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.bt-market-kind{font-size:11px;line-height:14px;color:var(--bt-ink-3)}
.bt-market-form{display:flex;flex-direction:column;gap:10px;padding:4px 0}
.bt-market-form-head{display:flex;flex-direction:column;gap:2px}
@media (prefers-reduced-motion:reduce){.bt-market-card{transition:none}}
`;
