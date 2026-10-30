// Secrets settings page and its row editors. Split from secret-card so each
// file stays inside the 350-line logic limit.
import { createElement as h, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckIcon, TrashIcon } from './icons.tsx';
import { BotAvatar } from './mark.tsx';
import { t } from './i18n.ts';
import { useEscape } from './overlay-hooks.ts';
import { KeyIcon, MaskedInput, } from './secret-card.tsx';
import type { SecretActions, SecretBot, SecretEntry, SecretScope, SecretsRoster, } from './secret-card.tsx';
import { dateLocale } from './i18n.ts';
const MIN_VALUE = 4;
const when = (time: number | undefined): string => (time !== undefined && Number.isFinite(time)
    ? new Date(time).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '');
interface ScopeEditorProps {
    secret: SecretEntry;
    roster: SecretsRoster;
    onSave: (scope: SecretScope) => unknown;
}
function ScopeEditor({ secret, roster, onSave }: ScopeEditorProps) {
    const [mode, setMode] = useState<'all' | 'some'>(secret.scope === 'all' ? 'all' : 'some');
    const [picked, setPicked] = useState<string[]>(secret.scope === 'all' ? [] : secret.scope);
    const toggle = (id: string): void => setPicked(list => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]));
    const same = mode === 'all' ? secret.scope === 'all' : secret.scope !== 'all' && [...picked].sort().join() === [...secret.scope].sort().join();
    return <div className='bt-secret-edit-block'><div className='bt-secret-edit-label'>{t('Who may use it')}</div><div className='bt-secret-radios' role='radiogroup' aria-label={t('Who may use {name}', { name: secret.name })}>{([['all', t('All Bots')], ['some', t('Chosen Bots')]] as const).map(([id, text]) => <label key={id} className='bt-secret-radio'><input type='radio' name={`scope-${secret.name}`} checked={mode === id} onChange={() => setMode(id)}/>{text}</label>)}</div>{mode === 'some' ? <div className='bt-secret-bots'>{roster.bots.map(bot => <button key={bot.id} type='button' className='bt-secret-bot' aria-pressed={picked.includes(bot.id)} onClick={() => toggle(bot.id)}><BotAvatar bot={bot} size={20} badge={false} live={false} />{bot.name}{picked.includes(bot.id) ? <CheckIcon /> : null}</button>)}</div> : null}<div className='bt-secret-row-actions'><button type='button' className='bt-soft bt-soft-sm' disabled={same} onClick={() => onSave(mode === 'all' ? 'all' : picked)}>{t('Save access')}</button></div></div>;
}
interface ValueEditorProps {
    secret: SecretEntry;
    onSave: (value: string) => unknown;
}
function ValueEditor({ secret, onSave }: ValueEditorProps) {
    const [value, setValue] = useState('');
    const [replaced, setReplaced] = useState(false);
    const long = value.trim().length >= MIN_VALUE;
    const save = (): void => {
        if (!long)
            return;
        void Promise.resolve(onSave(value)).then(ok => { if (ok) {
            setValue('');
            setReplaced(true);
        } });
    };
    const edit = (next: string): void => { setValue(next); setReplaced(false); };
    return <div className='bt-secret-edit-block'><div className='bt-secret-edit-label'>{t('Replace the value')}</div><div className='bt-secret-inline'><label className='bt-q-field bt-secret-field'><MaskedInput value={value} onChange={edit} onEnter={save} label={t('New value of {name}', { name: secret.name })} /></label><button type='button' className='bt-soft bt-soft-sm' disabled={!long} onClick={save}>{t('Replace')}</button></div>{value !== '' && !long ? <div className='bt-set-hint'>{t('At least {count} characters.', { count: MIN_VALUE })}</div> : replaced ? <div className='bt-set-hint bt-secret-ok' role='status'><CheckIcon />{t('Replaced. Bots get the new value from their next command.')}</div> : null}</div>;
}
interface SecretRowProps {
    secret: SecretEntry;
    roster: SecretsRoster;
    actions: SecretActions;
    run: (work: Promise<unknown>) => Promise<boolean>;
    open: boolean;
    onToggle: () => void;
}
function SecretRow({ secret, roster, actions, run, open, onToggle }: SecretRowProps) {
    const [confirm, setConfirm] = useState(false);
    useEffect(() => { if (!open)
        setConfirm(false); }, [open]);
    const asker = secret.requestedBy ? roster.byId[secret.requestedBy]?.name ?? t('a deleted Bot') : t('you');
    const allowed = secret.scope === 'all' ? [] : secret.scope.map(id => roster.byId[id]).filter((bot): bot is SecretBot => bot !== undefined);
    const meta = [t('Asked by {name}', { name: asker }), t('added {time}', { time: when(secret.createdAt) }), secret.lastUsedAt ? t('last used {time}', { time: when(secret.lastUsedAt) }) : t('not used yet')].join(' · ');
    return <div className='bt-secret-item' data-open={open ? '' : undefined}><button type='button' className='bt-set-row bt-secret-summary' aria-expanded={open} onClick={onToggle}><span className='bt-set-copy'><span className='bt-secret-title'><KeyIcon /><code className='bt-secret-name'>{secret.name}</code>{secret.purpose ? <span className='bt-secret-purpose'>{secret.purpose}</span> : null}</span><span className='bt-set-hint'>{meta}</span></span><span className='bt-set-control'>{secret.scope === 'all' ? <span className='bt-tag'>{t('All Bots')}</span> : allowed.length === 0 ? <span className='bt-tag'>{t('No Bot')}</span> : <span className='bt-secret-faces' title={allowed.map(bot => bot.name).join(', ')}>{allowed.slice(0, 5).map(bot => <BotAvatar key={bot.id} bot={bot} size={20} badge={false} live={false} />)}</span>}</span></button>{open ? <div className='bt-secret-edit'><ScopeEditor key={JSON.stringify(secret.scope)} secret={secret} roster={roster} onSave={scope => run(actions.secretUpdate(secret.name, scope))} /><ValueEditor secret={secret} onSave={value => run(actions.secretSet({ name: secret.name, value }))} /><div className='bt-secret-row-actions'>{confirm
        ? [
            <span key='q' className='bt-set-hint'>{t('Delete {name}? Bots lose it at once.', { name: secret.name })}</span>,
            <button key='no' type='button' className='bt-soft bt-soft-sm' onClick={() => setConfirm(false)}>{t('Keep')}</button>,
            <button key='yes' type='button' className='bt-soft bt-soft-sm bt-secret-danger' onClick={() => run(actions.secretDelete(secret.name))}>{t('Delete')}</button>,
        ]
        : <button type='button' className='bt-soft bt-soft-sm bt-secret-danger' onClick={() => setConfirm(true)}><TrashIcon />{t('Delete')}</button>}</div></div> : null}</div>;
}
interface AddSecretProps {
    actions: SecretActions;
    run: (work: Promise<unknown>) => Promise<boolean>;
    onDone: () => void;
}
function AddSecret({ actions, run, onDone }: AddSecretProps) {
    const [name, setName] = useState('');
    const [purpose, setPurpose] = useState('');
    const [value, setValue] = useState('');
    const ready = /^[A-Za-z][\w-]{0,63}$/.test(name.trim()) && value.trim().length >= MIN_VALUE;
    const save = (): void => {
        if (!ready)
            return;
        void run(actions.secretSet({ name, purpose, value, scope: 'all' })).then(ok => { if (ok) {
            setValue('');
            onDone();
        } });
    };
    return <div className='bt-set-row bt-set-paste bt-secret-add'><input className='bt-input' aria-label={t('Key name')} placeholder={t('NAME, e.g. GITHUB_TOKEN')} value={name} spellCheck={false} autoComplete='off' autoFocus onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value.toUpperCase())}/><input className='bt-input' aria-label={t('What it is for')} placeholder={t('What it is for')} value={purpose} autoComplete='off' onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPurpose(event.target.value)}/><label className='bt-q-field bt-secret-field'><MaskedInput value={value} onChange={setValue} onEnter={save} label={t('Value')} /></label><div className='bt-secret-row-actions'><span className='bt-set-hint'>{t('New keys are for all Bots; narrow it down afterwards.')}</span><button type='button' className='bt-soft bt-soft-sm' onClick={onDone}>{t('Cancel')}</button><button type='button' className='bt-soft bt-soft-sm' disabled={!ready} onClick={save}>{t('Save key')}</button></div></div>;
}
export interface SectionProps {
    title?: string | undefined;
    className?: string | undefined;
    children?: ReactNode | undefined;
}
export interface SecretsPageProps {
    roster: SecretsRoster;
    actions: SecretActions;
    run: (work: Promise<unknown>) => Promise<boolean>;
    Section: (props: SectionProps) => ReactNode;
}
export function SecretsPage({ roster, actions, run, Section }: SecretsPageProps) {
    const [open, setOpen] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    useEscape(() => setAdding(false), adding);
    useEscape(() => setOpen(null), open !== null && !adding);
    const secrets = roster.secrets ?? [];
    return [
        <p key='about' className='bt-secret-about'>{t('Keys your Bots asked for. Bots never see the values: they use them as ')}<code>$MOON_BOT_SECRET_NAME</code>{t(' in their shell, and every value is replaced by ')}<code>[secret:NAME]</code>{t(' before anything goes to a model.')}</p>,
        h(Section, { key: 'list', title: t('Secrets · {count}', { count: secrets.length }) }, secrets.length === 0 && !adding ? <div className='bt-set-row'><span className='bt-set-hint'>{t('No keys yet. When a Bot needs one, it shows a card in its chat.')}</span></div> : null, secrets.map(secret => <SecretRow key={secret.name} secret={secret} roster={roster} actions={actions} run={run} open={open === secret.name} onToggle={() => setOpen(open === secret.name ? null : secret.name)} />), adding ? <AddSecret actions={actions} run={run} onDone={() => setAdding(false)} /> : null),
        adding ? null : <div key='add' className='bt-actions'><button type='button' className='bt-soft bt-soft-sm' onClick={() => setAdding(true)}>{t('Add a key')}</button></div>,
    ];
}
