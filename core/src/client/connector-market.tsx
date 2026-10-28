import { createElement as h, useState, useMemo } from 'react';
import { spring, SPRING_TAP } from './motion.tsx';
import { MaskedInput } from './secret-card.tsx';
import { CheckIcon, SearchIcon, CloseIcon, PlusIcon } from './icons.tsx';
import { CONNECTOR_LOGOS, DefaultConnectorLogo } from './connector-logos.tsx';
import { t } from './i18n.ts';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATEGORIES,
  capabilityOf,
  type ConnectorCatalogEntry,
  type ConnectorCategory,
} from '../shared/connector-catalog.ts';

export interface MarketActions {
  secretSet: (payload: { name: string; value: string; purpose: string }) => Promise<unknown>;
  saveCapability: (item: Record<string, unknown>) => Promise<unknown>;
}

const CATEGORY_LABELS: Record<string, () => string> = {
  dev: () => t('Development'),
  web: () => t('Web & Search'),
  docs: () => t('Docs & Productivity'),
  data: () => t('Data & Storage'),
  cloud: () => t('Cloud & DevOps'),
  social: () => t('Social & Media'),
  intel: () => t('AI & Reasoning'),
};

function CatalogCard({ entry, isInstalled, onInstall }: { entry: ConnectorCatalogEntry; isInstalled: boolean; onInstall: () => void }) {
  const Logo = CONNECTOR_LOGOS[entry.id] ?? DefaultConnectorLogo;

  return (
    <button type='button' className='bt-market-card' onClick={onInstall}>
      <div className='bt-market-card-top'>
        <div className='bt-market-card-ident'>
          <span className='bt-market-icon'>{h(Logo, { size: 22 })}</span>
          <div className='bt-market-header'>
            <span className='bt-market-name'>{entry.name}</span>
            <span className='bt-market-kind'>{entry.transport === 'stdio' ? t('Local') : t('Cloud')}</span>
          </div>
        </div>
        {isInstalled ? (
          <span className='bt-market-installed' title={t('Installed')}>
            {h(CheckIcon)}
            <span>{t('Installed')}</span>
          </span>
        ) : null}
      </div>
      <p className='bt-market-desc'>{t(entry.description)}</p>
      <div className='bt-market-meta'>
        <span className='bt-market-cat'>{CATEGORY_LABELS[entry.category]?.() ?? entry.category}</span>
        <span className='bt-market-action'>{isInstalled ? t('Configured') : t('Install')}</span>
      </div>
    </button>
  );
}

function InstallForm({
  entry,
  isInstalled,
  market,
  onClose,
}: {
  entry: ConnectorCatalogEntry;
  isInstalled: boolean;
  market: MarketActions;
  onClose: () => void;
}) {
  const Logo = CONNECTOR_LOGOS[entry.id] ?? DefaultConnectorLogo;
  const required = (entry.secrets ?? []).filter(secret => secret.optional !== true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = (): void => {
    if (busy || required.some(secret => (values[secret.name] ?? '').trim() === '')) return;
    setBusy(true);
    setError(null);
    const secrets = (entry.secrets ?? []).filter(secret => (values[secret.name] ?? '').trim() !== '');
    void Promise.all(secrets.map(secret => market.secretSet({ name: secret.name, value: values[secret.name] ?? '', purpose: `${entry.name} connector` })))
      .then(() => market.saveCapability(capabilityOf(entry)))
      .then(onClose, failure => setError(failure?.message ?? String(failure)))
      .finally(() => setBusy(false));
  };

  return (
    <div className='bt-market-form'>
      <div className='bt-market-form-head'>
        <div className='bt-market-form-title-row'>
          <span className='bt-market-icon bt-market-form-icon'>{h(Logo, { size: 28 })}</span>
          <div className='bt-market-form-info'>
            <div className='bt-market-form-name-row'>
              <span className='bt-market-name'>{entry.name}</span>
              <span className='bt-market-kind'>{entry.transport === 'stdio' ? t('Runs locally') : t('Hosted service')}</span>
            </div>
            <span className='bt-market-desc'>{t(entry.description)}</span>
          </div>
        </div>
        {entry.website ? <div className='bt-market-form-links'><a className='bt-connector-link' href={entry.website} target='_blank' rel='noopener noreferrer'>{t('Official website')} ↗</a></div> : null}
        {isInstalled ? <div className='bt-market-notice'>{t('This connector is already installed as a capability. Installing again will update its configuration.')}</div> : null}
      </div>

      {(entry.secrets ?? []).length > 0 ? (
        (entry.secrets ?? []).map(secret => (
          <label key={secret.name} className='bt-q-field bt-secret-field'>
            {h(MaskedInput, {
              value: values[secret.name] ?? '',
              onChange: next => setValues(last => ({ ...last, [secret.name]: next })),
              onEnter: install,
              label: t(secret.label) + (secret.optional === true ? t(' (optional)') : ''),
              autoFocus: secret === required[0],
            })}
            {secret.url !== undefined ? <a className='bt-connector-link' href={secret.url} target='_blank' rel='noopener noreferrer'>{t('Get it here')} ↗</a> : null}
          </label>
        ))
      ) : (
        <div className='bt-set-hint'>
          {entry.transport === 'stdio' ? t('Runs a local command; Moon Bot asks before it first starts.') : t('Connects to the service over HTTPS.')}
        </div>
      )}

      <div className='bt-connector-form-row'>
        <button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onClose}>{t('Cancel')}</button>
        <button type='button' className='bt-soft bt-soft-sm' disabled={busy || required.some(secret => (values[secret.name] ?? '').trim() === '')} onClick={install}>
          {busy ? t('Installing…') : isInstalled ? t('Save changes') : t('Install')}
        </button>
      </div>

      {error ? <div className='bt-connector-error' role='alert'>{error}</div> : null}
    </div>
  );
}

function CustomConnectorForm({ market, onClose }: { market: MarketActions; onClose: () => void }) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('stdio');
  const [target, setTarget] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);
    if (!id || !target.trim()) { setError(t('Please fill in the name and command or URL.')); return; }
    setBusy(true);
    setError(null);
    const item: Record<string, unknown> = {
      name: id,
      kind: 'mcp',
      description: desc.trim() || `${name} MCP Server`,
      transport,
      ...(transport === 'stdio'
        ? { command: target.trim().split(/\s+/)[0] ?? 'npx', args: target.trim().split(/\s+/).slice(1) }
        : { url: target.trim() }),
    };
    market.saveCapability(item).then(onClose, failure => setError(failure?.message ?? String(failure))).finally(() => setBusy(false));
  };

  return (
    <form className='bt-market-form' onSubmit={submit}>
      <div className='bt-market-form-head'>
        <div className='bt-market-form-title-row'>
          <span className='bt-market-icon bt-market-form-icon'>{h(DefaultConnectorLogo, { size: 28 })}</span>
          <div className='bt-market-form-info'>
            <span className='bt-market-name'>{t('Custom MCP server')}</span>
            <span className='bt-market-desc'>{t('Enter any command or HTTP endpoint to connect any community or custom MCP server.')}</span>
          </div>
        </div>
      </div>
      <label className='bt-q-field bt-secret-field'>
        <span className='bt-set-hint'>{t('Name')}</span>
        <input className='bt-input' autoFocus placeholder='my-custom-tool' value={name} onChange={e => setName(e.target.value)} />
      </label>
      <label className='bt-q-field bt-secret-field'>
        <span className='bt-set-hint'>{t('Type')}</span>
        <select className='bt-input' value={transport} onChange={e => setTransport(e.target.value as 'stdio' | 'streamable-http')}>
          <option value='stdio'>{t('Local command (stdio)')}</option>
          <option value='streamable-http'>{t('HTTP server (streamable-http)')}</option>
        </select>
      </label>
      <label className='bt-q-field bt-secret-field'>
        <span className='bt-set-hint'>{transport === 'stdio' ? t('Command') : t('URL')}</span>
        <input className='bt-input' placeholder={transport === 'stdio' ? 'npx -y any-mcp-server' : 'https://mcp.example.com/mcp'} value={target} onChange={e => setTarget(e.target.value)} />
      </label>
      <label className='bt-q-field bt-secret-field'>
        <span className='bt-set-hint'>{t('Description')}</span>
        <input className='bt-input' placeholder={t('What this tool does')} value={desc} onChange={e => setDesc(e.target.value)} />
      </label>
      {error ? <div className='bt-connector-error' role='alert'>{error}</div> : null}
      <div className='bt-connector-form-row'>
        <button type='button' className='bt-soft bt-soft-sm' disabled={busy} onClick={onClose}>{t('Cancel')}</button>
        <button type='submit' className='bt-soft bt-soft-sm' disabled={busy || !name.trim() || !target.trim()}>{busy ? t('Adding…') : t('Add capability')}</button>
      </div>
    </form>
  );
}

export function ConnectorCatalog({ market, capabilities }: { market: MarketActions; capabilities?: readonly { name: string }[] | undefined }) {
  const [installing, setInstalling] = useState<ConnectorCatalogEntry | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ConnectorCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const installedSet = useMemo(() => new Set((capabilities ?? []).map(c => c.name)), [capabilities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CONNECTOR_CATALOG.filter(entry => {
      if (selectedCategory !== 'all' && entry.category !== selectedCategory) return false;
      if (!q) return true;
      const localizedName = entry.name.toLowerCase();
      const localizedDesc = t(entry.description).toLowerCase();
      const rawDesc = entry.description.toLowerCase();
      return entry.id.includes(q) || localizedName.includes(q) || localizedDesc.includes(q) || rawDesc.includes(q);
    });
  }, [selectedCategory, search]);

  return (
    <div className='bt-market'>
      <div className='bt-market-header-area'>
        <div className='bt-market-title-group'>
          <div className='bt-market-title-row'>
            <h3 className='bt-market-title'>{t('Connector market')}</h3>
            <span className='bt-market-total-badge'>{CONNECTOR_CATALOG.length}+</span>
          </div>
          <p className='bt-market-note'>{t('One click adds the MCP service as a capability every Bot can use.')}</p>
        </div>
        <div className='bt-market-actions'>
          <button type='button' className='bt-soft bt-soft-sm bt-market-custom-btn' onClick={() => setCustomOpen(true)}>
            {h(PlusIcon)}
            <span>{t('Custom MCP')}</span>
          </button>
          <div className='bt-market-search'>
            <span className='bt-market-search-icon'>{h(SearchIcon)}</span>
            <input type='text' className='bt-market-search-input' placeholder={t('Search connectors…')} value={search} onChange={e => setSearch(e.target.value)} />
            {search ? <button type='button' className='bt-market-search-clear' onClick={() => setSearch('')} aria-label={t('Clear search')}>{h(CloseIcon)}</button> : null}
          </div>
        </div>
      </div>

      <div className='bt-market-tabs'>
        <button type='button' className={`bt-market-tab ${selectedCategory === 'all' ? 'bt-market-tab-active' : ''}`} onClick={() => setSelectedCategory('all')}>
          {t('All')} ({CONNECTOR_CATALOG.length})
        </button>
        {CONNECTOR_CATEGORIES.map(cat => {
          const count = CONNECTOR_CATALOG.filter(e => e.category === cat.id).length;
          return (
            <button key={cat.id} type='button' className={`bt-market-tab ${selectedCategory === cat.id ? 'bt-market-tab-active' : ''}`} onClick={() => setSelectedCategory(cat.id)}>
              {CATEGORY_LABELS[cat.id]?.() ?? cat.label} ({count})
            </button>
          );
        })}
      </div>

      {customOpen ? (
        h(CustomConnectorForm, { market, onClose: () => setCustomOpen(false) })
      ) : installing !== null ? (
        h(InstallForm, { key: installing.id, entry: installing, isInstalled: installedSet.has(installing.id), market, onClose: () => setInstalling(null) })
      ) : filtered.length === 0 ? (
        <div className='bt-market-empty'>
          <span className='bt-set-hint'>{t('No connectors match “{query}”', { query: search })}</span>
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => { setSearch(''); setSelectedCategory('all'); }}>{t('Clear search')}</button>
        </div>
      ) : (
        <div className='bt-market-grid'>
          {filtered.map(entry => h(CatalogCard, { key: entry.id, entry, isInstalled: installedSet.has(entry.id), onInstall: () => setInstalling(entry) }))}
        </div>
      )}
    </div>
  );
}

export const MARKET_CSS = `
.bt-market{display:flex;flex-direction:column;gap:12px;padding:16px}
.bt-market-header-area{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.bt-market-title-group{display:flex;flex-direction:column;gap:2px}
.bt-market-title-row{display:flex;align-items:center;gap:8px}
.bt-market-title{margin:0;font-size:15px;line-height:22px;font-weight:600}
.bt-market-total-badge{font-size:11px;line-height:14px;padding:1px 6px;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2);font-weight:600}
.bt-market-note{margin:0;font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-market-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bt-market-custom-btn{display:inline-flex;align-items:center;gap:4px;height:32px}
.bt-market-search{display:flex;align-items:center;gap:6px;min-width:180px;max-width:240px;height:32px;padding:0 8px;border:1px solid var(--bt-line);border-radius:8px;background:var(--bt-card);transition:border-color .15s ease}
.bt-market-search:focus-within{border-color:var(--bt-accent)}
.bt-market-search-icon{display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink-3);flex:none}
.bt-market-search-input{flex:1;min-width:0;border:0;outline:none;background:transparent;color:var(--bt-ink);font:inherit;font-size:12px}
.bt-market-search-clear{border:0;background:none;padding:2px;display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink-3);cursor:pointer;border-radius:4px}
.bt-market-search-clear:hover{color:var(--bt-ink)}
.bt-market-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.bt-market-tab{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;border:1px solid var(--bt-line);background:var(--bt-main);color:var(--bt-ink-2);font:inherit;font-size:12px;line-height:16px;cursor:pointer;transition:all .12s ease}
.bt-market-tab:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-market-tab-active{background:var(--bt-ink);color:var(--bt-main);border-color:var(--bt-ink);font-weight:500}
.bt-market-tab-active:hover{background:var(--bt-ink);color:var(--bt-main)}
.bt-market-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.bt-market-card{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-height:116px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform ${spring(SPRING_TAP, 'transform')};box-sizing:border-box}
.bt-market-card:hover{background:var(--bt-hover);border-color:var(--bt-line-2);transform:translateY(-1px)}
.bt-market-card:active{transform:translateY(0)}
.bt-market-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-market-card-ident{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.bt-market-icon{flex:none;width:34px;height:34px;border-radius:10px;background:var(--bt-main);border:1px solid var(--bt-line);display:flex;align-items:center;justify-content:center;color:var(--bt-ink)}
.bt-market-form-icon{width:40px;height:40px;border-radius:12px}
.bt-market-header{display:flex;flex-direction:column;gap:1px;min-width:0}
.bt-market-name{font-size:13px;line-height:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-market-kind{font-size:11px;line-height:14px;color:var(--bt-ink-3)}
.bt-market-installed{display:inline-flex;align-items:center;gap:3px;font-size:11px;line-height:14px;font-weight:500;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--bt-green) 14%,transparent);color:var(--bt-green);flex:none}
.bt-market-desc{margin:0;font-size:12px;line-height:17px;color:var(--bt-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex:1}
.bt-market-meta{margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:6px;padding-top:4px;border-top:1px solid var(--bt-line)}
.bt-market-cat{font-size:11px;line-height:14px;padding:2px 7px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.bt-market-action{font-size:12px;line-height:16px;color:var(--bt-accent);font-weight:500}
.bt-market-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 16px;text-align:center}
.bt-market-form{display:flex;flex-direction:column;gap:12px;padding:6px 0}
.bt-market-form-head{display:flex;flex-direction:column;gap:8px;padding-bottom:6px;border-bottom:1px solid var(--bt-line)}
.bt-market-form-title-row{display:flex;align-items:center;gap:12px}
.bt-market-form-info{display:flex;flex-direction:column;gap:2px;flex:1}
.bt-market-form-name-row{display:flex;align-items:baseline;gap:8px}
.bt-market-form-links{display:flex;gap:10px}
.bt-market-notice{font-size:12px;line-height:16px;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--bt-accent) 10%,transparent);color:var(--bt-accent)}
@media (prefers-reduced-motion:reduce){.bt-market-card{transition:none}}
`;
