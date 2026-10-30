// Writing a pre-authorised rule: the one place in the interface where a user grants a Bot
// standing permission, so it says what the rule may do and what it may never do, in the
// user's own words, before it can be saved.
//
// Everything here is deliberately narrow. There is no "allow everything", no preset that
// fills in a scope, and no way to reach a tool the policy keeps for the user: the host
// refuses those whatever the form sends, and the form says so instead of discovering it
// after a refusal.
import { createElement as h, useEffect, useState } from 'react';
import { t } from './i18n.ts';
import { ClockIcon } from './icons.tsx';
import { Card, EmptyState } from 'moon-bot-ui';

export interface PreAuthRule {
  readonly id: string;
  readonly subscriptionId: string;
  readonly purpose: string;
  readonly tools: readonly string[];
  readonly prohibitions: readonly string[];
  readonly dailyCap: number;
  readonly respectQuietHours: boolean;
  readonly audit?: readonly { readonly tool: string; readonly outcome: string; readonly reason: string | null; readonly at: number }[] | undefined;
}

export interface PreAuthActions {
  preAuthList?: ((botId: string) => Promise<readonly PreAuthRule[]>) | undefined;
  preAuthWrite: (input: {
    botId: string;
    subscriptionId: string;
    purpose: string;
    minutes: number;
    tools: readonly string[];
    prohibitions: readonly string[];
    dailyCap: number;
    allowQuietHours: boolean;
  }) => Promise<unknown>;
  preAuthRevoke: (id: string) => Promise<unknown>;
}

interface Choice {
  readonly tool: string;
  readonly label: string;
  /** What it does, in the user's terms rather than the tool's name. */
  readonly what: string;
  /** False for the ones the policy keeps for the user, shown so the list is not a mystery. */
  readonly allowed: boolean;
}

/**
 * The tools a rule may ever cover, in words a user can judge.
 *
 * L3 and L4 appear with `allowed: false`: hiding them would leave the user wondering why
 * their rule does nothing, and the reason is worth stating — spending money and
 * irreversible changes always ask.
 */
export const RULE_TOOLS: readonly Choice[] = [
  { tool: 'message_bot', label: 'Message another Bot', what: 'Hand work to a teammate', allowed: true },
  { tool: 'update_bot', label: 'Adjust a Bot’s setup', what: 'Change instructions, model or folder', allowed: true },
  { tool: 'read_own_chat', label: 'Read its own chat', what: 'Look back over what was said', allowed: true },
  { tool: 'post_to_group', label: 'Post in a group chat', what: 'Say something where the team can see', allowed: true },
  { tool: 'web_search', label: 'Search the web', what: 'Always asks, because it costs money', allowed: false },
  { tool: 'create_bot', label: 'Create a new Bot', what: 'Always asks, because it cannot be undone', allowed: false },
];

const inputValue = (event: { readonly target: EventTarget }): string => (event.target as HTMLInputElement).value;

function RuleRow({ rule, actions, onChange }: { rule: PreAuthRule; actions: PreAuthActions; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  const revoke = () => {
    if (!confirming) { setConfirming(true); return; }
    void actions.preAuthRevoke(rule.id).then(onChange, () => undefined);
  };
  const audit = rule.audit ?? [];
  return <li className='bt-pro-row bt-preauth-row'>
    <div className='bt-pro-row-copy'>
      <span className='bt-pro-topics'>{rule.purpose}</span>
      <span className='bt-pro-meta'>
        {t('May use: {tools}', { tools: rule.tools.join(', ') })}
        {' · '}
        {t('At most {count} a day', { count: rule.dailyCap })}
        {' · '}
        {rule.respectQuietHours ? t('Quiet hours respected') : t('May act at night')}
      </span>
      {rule.prohibitions.length === 0 ? null
        : <span className='bt-pro-meta'>{t('Never: {tools}', { tools: rule.prohibitions.join(', ') })}</span>}
      {audit.length === 0 ? null : <button type='button' className='bt-preauth-audit-toggle' aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('What it has done ({count})', { count: audit.length })}
      </button>}
      {open ? <ul className='bt-preauth-audit'>
        {audit.slice(0, 10).map(line => <li key={`${line.at}-${line.tool}`}>
          {new Date(line.at).toLocaleString()} · {line.tool} · {line.outcome}
          {line.reason === null ? '' : ` · ${line.reason}`}
        </li>)}
      </ul> : null}
    </div>
    <button type='button' className='bt-soft bt-soft-sm bt-pro-danger' onClick={revoke} onBlur={() => setConfirming(false)}>
      {confirming ? t('Confirm') : t('Revoke')}
    </button>
  </li>;
}

function RuleForm({ botId, subscriptionId, actions, onDone }: {
  botId: string;
  subscriptionId: string;
  actions: PreAuthActions;
  onDone: () => void;
}) {
  const [purpose, setPurpose] = useState('');
  const [minutes, setMinutes] = useState('10');
  const [cap, setCap] = useState('3');
  const [tools, setTools] = useState<readonly string[]>([]);
  const [night, setNight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleTool = (tool: string) => {
    setTools(current => current.includes(tool) ? current.filter(item => item !== tool) : [...current, tool]);
  };
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    const reason = purpose.trim();
    if (reason === '') { setError(t('Say what this rule is for.')); return; }
    if (tools.length === 0) { setError(t('Pick at least one thing it may do.')); return; }
    setBusy(true);
    setError(null);
    void actions.preAuthWrite({
      botId, subscriptionId, purpose: reason,
      minutes: Number(minutes) || 10,
      tools, prohibitions: [], dailyCap: Number(cap) || 3,
      allowQuietHours: night,
    }).then(() => { setPurpose(''); setTools([]); setBusy(false); onDone(); }, (problem: unknown) => {
      setBusy(false);
      setError(problem instanceof Error ? problem.message : t('That did not work.'));
    });
  };
  return <form className='bt-pro-form' onSubmit={submit}>
    <label className='bt-pro-field'>
      <span className='bt-pro-label'>{t('What is this rule for?')}</span>
      <input value={purpose} onChange={event => setPurpose(inputValue(event))} placeholder={t('hand off work that has stalled')} />
    </label>
    <div className='bt-pro-inline'>
      <label className='bt-pro-field bt-pro-narrow'>
        <span className='bt-pro-label'>{t('After this many minutes of silence')}</span>
        <input type='number' min='1' value={minutes} onChange={event => setMinutes(inputValue(event))} />
      </label>
      <label className='bt-pro-field bt-pro-narrow'>
        <span className='bt-pro-label'>{t('At most a day')}</span>
        <input type='number' min='1' max='5' value={cap} onChange={event => setCap(inputValue(event))} />
      </label>
    </div>
    <div className='bt-pro-field'>
      <span className='bt-pro-label'>{t('What may it do without asking?')}</span>
      <ul className='bt-preauth-tools'>
        {RULE_TOOLS.map(choice => <li key={choice.tool}>
          <label className='bt-preauth-tool' data-allowed={choice.allowed || undefined}>
            <input
              type='checkbox'
              checked={tools.includes(choice.tool)}
              disabled={!choice.allowed}
              onChange={() => toggleTool(choice.tool)}
            />
            <span className='bt-preauth-tool-copy'>
              <span>{choice.label}</span>
              <span className='bt-pro-meta'>{choice.what}</span>
            </span>
          </label>
        </li>)}
      </ul>
    </div>
    <label className='bt-preauth-tool'>
      <input type='checkbox' checked={night} onChange={() => setNight(!night)} />
      <span className='bt-preauth-tool-copy'>
        <span>{t('Also during quiet hours')}</span>
        <span className='bt-pro-meta'>{t('Without this, the rule waits until the quiet hours end — even for a rescue.')}</span>
      </span>
    </label>
    {night ? <div className='bt-preauth-warning' role='note'>
      {t('This rule will be able to act at 3 in the morning without asking you.')}
    </div> : null}
    <div className='bt-preauth-note' role='note'>
      {t('Anything that spends money or cannot be undone always asks, whatever a rule says.')}
    </div>
    {error === null ? null : <div className='bt-pro-error' role='alert'>{error}</div>}
    <button type='submit' className='bt-soft bt-soft-sm' disabled={busy}>{busy ? t('Saving…') : t('Write this rule')}</button>
  </form>;
}

export function PreAuthCard({ botId, subscriptionId, actions }: {
  botId: string;
  subscriptionId: string;
  actions: PreAuthActions;
}) {
  const [rules, setRules] = useState<readonly PreAuthRule[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => {
    void (actions.preAuthList?.(botId) ?? Promise.resolve([])).then(
      all => setRules(all.filter(rule => rule.subscriptionId === subscriptionId)),
      () => setRules([]),
    );
  };
  useEffect(load, [botId, subscriptionId]);
  if (actions.preAuthList === undefined) return null;
  return <Card title={t('Standing permission')}>
    <div className='bt-pro-card'>
      <p className='bt-pro-hint'>{t('A rule lets this Bot act on its own within limits you write down here. Outside them it can only suggest.')}</p>
      {rules === null ? null : rules.length === 0
        ? <EmptyState icon={<ClockIcon />} title={t('No standing permission')} hint={t('The Bot will only ever suggest things, never act by itself.')} />
        : <ul className='bt-pro-list'>
          {rules.map(rule => <RuleRow key={rule.id} rule={rule} actions={actions} onChange={load} />)}
        </ul>}
      {adding
        ? <RuleForm botId={botId} subscriptionId={subscriptionId} actions={actions} onDone={() => { setAdding(false); load(); }} />
        : <button type='button' className='bt-soft bt-soft-sm bt-pro-add' onClick={() => setAdding(true)}>
          {t('Write a rule')}
        </button>}
    </div>
  </Card>;
}
