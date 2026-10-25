// Secret cards: a Bot's request_secret shows a card where the user types a key the
// Bot never sees, or lets the Bot use a key that is already saved. The settings page
// lists the saved keys and who may use them. Values only ever travel from these
// inputs to the host; nothing here reads one back.
import { createElement as h, useId, useRef, useState } from 'react';
import { CheckIcon, CloseIcon } from './icons.tsx';
import { BotMark } from './mark.tsx';
import { contentText, currentPart } from './text.ts';
import { t } from './i18n.ts';
import { useDockHold } from './card-hold.ts';
import { heldCardKey } from './sources.ts';
const MIN_VALUE = 4;
const NONE: Record<string, number> = {};
// A stored key's scope: every Bot, or the listed Bot ids.
export type SecretScope = 'all' | string[];
// What a save asks for: the card's "only this Bot" choice resolves to `bot` on the host.
export type SecretSetScope = 'all' | 'bot' | string[];
// One saved key as the settings page reads it; the value never comes back.
export interface SecretEntry {
    readonly name: string;
    readonly purpose?: string | undefined;
    readonly scope: SecretScope;
    readonly requestedBy?: string | null | undefined;
    readonly createdAt?: number | undefined;
    readonly lastUsedAt?: number | undefined;
}
// One card a Bot asked for, kept by the host.
export interface SecretRequest {
    readonly id: string;
    readonly callId?: string | undefined;
    readonly sessionId?: string | undefined;
    readonly name: string;
    readonly purpose?: string | undefined;
    readonly kind: 'fill' | 'allow';
    readonly status?: 'pending' | 'saved' | 'allowed' | 'canceled' | undefined;
    readonly scope?: SecretScope | undefined;
}
export interface SecretBot {
    id: string;
    name: string;
}
export interface SecretRoster {
    byId: Record<string, SecretBot | undefined>;
    secrets?: readonly SecretEntry[] | undefined;
    secretRequests?: Record<string, readonly SecretRequest[] | undefined> | undefined;
}
export interface SecretsRoster extends SecretRoster {
    bots: readonly SecretBot[];
}
export interface SecretActions {
    secretSet: (payload: {
        requestId?: string | undefined;
        name?: string | undefined;
        value: string;
        scope?: SecretSetScope | undefined;
        purpose?: string | undefined;
    }) => Promise<unknown>;
    secretAllow: (requestId: string) => Promise<unknown>;
    secretCancel: (requestId: string) => Promise<unknown>;
    secretUpdate: (name: string, scope: SecretScope) => Promise<unknown>;
    secretDelete: (name: string) => Promise<unknown>;
    noteHeldCard?: (sessionId: string, kind: string, requestId: string, delta: number) => void;
}
export const KeyIcon = () => <svg width={15} height={15} viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={1.5} strokeLinecap='round' strokeLinejoin='round' aria-hidden><path d='M7 9.5a3.5 3.5 0 1 1 0 .01z'/><path d='M10.4 10.6L17 10.6M14.5 10.6v2.4M16.6 10.6v1.8'/></svg>;
const LockIcon = () => <svg width={14} height={14} viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={1.5} strokeLinecap='round' strokeLinejoin='round' aria-hidden><path d='M6.5 9V7a3.5 3.5 0 0 1 7 0v2'/><rect x={4.5} y={9} width={11} height={8} rx={2}/></svg>;
const WarnIcon = () => <svg width={14} height={14} viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={1.5} strokeLinecap='round' strokeLinejoin='round' aria-hidden><path d='M10 3.5l7 12.5H3z'/><path d='M10 8.5v3.5M10 14.2h.01'/></svg>;
const failureMessage = (failure: unknown): string => (failure as {
    message?: string;
} | null)?.message ?? String(failure);
// Password managers ignore a text field masked by CSS, so it never offers to save the
// key; browsers without that CSS fall back to a new-password field.
const MASK_BY_CSS = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');
const insecure = (): boolean => typeof location !== 'undefined' && location.protocol === 'http:'
    && !/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(location.hostname);
const scopeLabel = (scope: SecretScope | undefined, roster: SecretRoster): string => {
    if (scope === 'all')
        return t('All Bots');
    const names = (scope ?? []).map(id => roster.byId[id]?.name).filter((name): name is string => name !== undefined);
    return names.length === 0 ? t('No Bot') : names.join(t(' and '));
};
export interface MaskedInputProps {
    value: string;
    onChange: (value: string) => void;
    onEnter?: (() => void) | undefined;
    label: string;
    autoFocus?: boolean | undefined;
}
export function MaskedInput({ value, onChange, onEnter, label, autoFocus = false }: MaskedInputProps) {
    return <input className='bt-secret-input' type={MASK_BY_CSS ? 'text' : 'password'} data-masked={MASK_BY_CSS ? '' : undefined} value={value} autoFocus={autoFocus} autoComplete={MASK_BY_CSS ? 'off' : 'new-password'} autoCorrect='off' autoCapitalize='off' spellCheck={false} data-1p-ignore='' data-lpignore='true' data-bwignore='' data-form-type='other' aria-label={label} placeholder={t('Paste or type the key')} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing)
            return;
        event.preventDefault();
        onEnter?.();
    }}/>;
}
type ScopeChoice = 'all' | 'bot';
interface ScopeSwitchProps {
    value: ScopeChoice;
    onChange: (value: ScopeChoice) => void;
    bot: SecretBot;
}
function ScopeSwitch({ value, onChange, bot }: ScopeSwitchProps) {
    const options: [
        ScopeChoice,
        string
    ][] = [['all', t('All Bots')], ['bot', t('Only {name}', { name: bot.name })]];
    return <div className='bt-secret-scope' role='radiogroup' aria-label={t('Who may use it')}><span className='bt-secret-glide' data-at={value === 'all' ? 0 : 1} aria-hidden/>{options.map(([id, text]) => <button key={id} type='button' role='radio' aria-checked={value === id} className='bt-secret-seg' onClick={() => onChange(id)}>{text}</button>)}</div>;
}
interface SecretHeadProps {
    bot: SecretBot;
    title: string;
    detail?: string | undefined;
    name: string;
    onClose?: (() => void) | undefined;
}
function SecretHead({ bot, title, detail, name, onClose }: SecretHeadProps) {
    return <div className='bt-q-head bt-secret-head'><span className='bt-secret-who'>{h(BotMark, { bot, size: 28 })}<span className='bt-secret-lock'>{h(LockIcon)}</span></span><div className='bt-q-text'><p className='bt-q-title'>{title}</p><div className='bt-q-detail'><code className='bt-secret-name'>{name}</code>{detail ? ` · ${detail}` : ''}</div></div>{onClose ? <button type='button' className='bt-q-x' aria-label={t('Cancel the request')} title={t('Cancel')} onClick={onClose}>{h(CloseIcon)}</button> : null}</div>;
}
export interface SecretCardProps {
    sessionId: string;
    bot: SecretBot;
    request: SecretRequest;
    roster: SecretRoster;
    actions: SecretActions;
    inline?: boolean | undefined;
}
export function SecretCard({ sessionId, bot, request, roster, actions, inline = false }: SecretCardProps) {
    const [value, setValue] = useState('');
    const [scope, setScope] = useState<ScopeChoice>('all');
    const [replacing, setReplacing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const busyRef = useRef(false);
    const hold = useDockHold(sessionId, 'secret', request.id, actions, inline);
    const noteId = useId();
    const secret = (roster.secrets ?? []).find(entry => entry.name === request.name);
    const run = (make: () => unknown): Promise<unknown> | undefined => {
        if (busyRef.current)
            return undefined;
        hold();
        busyRef.current = true;
        setBusy(true);
        setError('');
        return Promise.resolve().then(make).then(() => setValue(''), failure => setError(failureMessage(failure))).finally(() => {
            busyRef.current = false;
            setBusy(false);
        });
    };
    const cancel = (): Promise<unknown> | undefined => run(() => actions.secretCancel(request.id));
    const long = value.trim().length >= MIN_VALUE;
    const save = (): void => { if (long && !busy)
        void run(() => actions.secretSet({ requestId: request.id, value, scope })); };
    const allow = (): void => { if (!busy)
        void run(() => actions.secretAllow(request.id)); };
    const filling = request.kind === 'fill' || replacing;
    const warn = insecure() ? <div className='bt-secret-warn' role='note'>{h(WarnIcon)}{t('This page is not on HTTPS: the key crosses the network unencrypted.')}</div> : null;
    return <div className='bt-q bt-secret' role='group' aria-describedby={noteId} data-kind={request.kind} onFocusCapture={hold} onPointerDownCapture={hold} onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || busy)
            return;
        event.preventDefault();
        event.stopPropagation();
        if (request.kind === 'allow' && replacing)
            setReplacing(false);
        else
            void cancel();
    }}>{h(SecretHead, {
        bot,
        title: request.kind === 'allow' ? t('Let {bot} use {name}?', { bot: bot.name, name: request.name }) : t('{name} needs a key', { name: bot.name }),
        detail: request.purpose,
        name: request.name,
        onClose: busy ? undefined : cancel,
    })}{request.kind === 'allow' ? <div className='bt-secret-saved'>{h(KeyIcon)}{t('Saved for {scope}', { scope: scopeLabel(secret?.scope, roster) })}</div> : null}{filling ? <div className='bt-secret-body'><label className='bt-q-field bt-secret-field'>{h(MaskedInput, { value, onChange: next => { hold(); setValue(next); }, onEnter: save, label: t('Value of {name}', { name: request.name }), autoFocus: replacing })}</label>{request.kind === 'fill' ? h(ScopeSwitch, { value: scope, onChange: next => { hold(); setScope(next); }, bot }) : null}</div> : null}<div className='bt-secret-note' id={noteId}>{t("{bot} never sees the value. It reaches {bot}'s shell as ", { bot: bot.name })}<code>{`$MOON_BOT_SECRET_${request.name}`}</code>.{filling && value !== '' && !long ? t(' At least {count} characters.', { count: MIN_VALUE }) : ''}</div>{warn}{error ? <div className='bt-secret-error' role='alert'>{error}</div> : null}<div className='bt-q-foot'>{request.kind === 'allow' && !replacing ? <button type='button' className='bt-q-btn' disabled={busy} onClick={() => { hold(); setReplacing(true); }}>{t('Replace value')}</button> : null}<button type='button' className='bt-q-btn' disabled={busy} onClick={cancel}>{t('Cancel')}</button>{filling
        ? <button type='button' className='bt-q-submit' disabled={!long || busy} onClick={save}>{busy ? t('Saving…') : t('Save')}</button> : <button type='button' className='bt-q-submit' disabled={busy} onClick={allow}>{busy ? t('Allowing…') : t('Allow')}</button>}</div></div>;
}
function SettledSecret({ bot, request, roster }: {
    bot: SecretBot;
    request: SecretRequest;
    roster: SecretRoster;
}) {
    const canceled = request.status === 'canceled';
    const text = canceled ? t('{bot} asked for {name}', { bot: bot.name, name: request.name })
        : request.status === 'allowed' ? t('Allowed {bot} to use {name}', { bot: bot.name, name: request.name })
            : t('Saved {name}', { name: request.name });
    return <div className='bt-q bt-q-settled bt-secret bt-secret-done' role='group' aria-label={text} data-status={request.status}><div className='bt-q-head'><span className='bt-secret-who'>{h(BotMark, { bot, size: 22 })}</span><div className='bt-q-text'><p className='bt-q-title'>{text}{canceled ? null : <span className='bt-secret-scope-tag'>{` · ${scopeLabel(request.scope, roster)}`}</span>}</p></div>{canceled ? <span className='bt-q-badge'>{t('Canceled')}</span> : <span className='bt-q-check bt-secret-check' title={t('Done')}>{h(CheckIcon)}</span>}</div></div>;
}
interface RequestViewProps {
    sessionId: string;
    bot: SecretBot;
    request: SecretRequest;
    roster: SecretRoster;
    actions: SecretActions;
}
function RequestView({ sessionId, bot, request, roster, actions }: RequestViewProps) {
    return request.status === 'pending'
        ? h(SecretCard, { key: JSON.stringify([sessionId, request.id, request.kind]), sessionId, bot, request, roster, actions, inline: true })
        : h(SettledSecret, { bot, request, roster });
}
// What a client may pass as a call's content; only the text blocks matter here.
export type SecretContent = Parameters<typeof contentText>[0];
export interface SecretToolCellProps {
    sessionId: string;
    callId: string;
    name?: string | undefined;
    done?: boolean | undefined;
    content?: SecretContent;
    roster: SecretRoster;
    actions: SecretActions;
    heldCards?: Record<string, number> | undefined;
}
// The card at its request_secret call; a key that was already there gets one line.
export function SecretToolCell({ sessionId, callId, name, done, content, roster, actions, heldCards = NONE }: SecretToolCellProps) {
    const bot = roster.byId[sessionId];
    if (!bot)
        return null;
    // Call ids repeat across a Bot's chat parts.
    const request = (roster.secretRequests?.[bot.id] ?? []).find(entry => entry.callId === callId && (entry.sessionId ?? sessionId) === sessionId);
    if (request?.status === 'pending' && (heldCards[heldCardKey('secret', request.id)] ?? 0) > 0)
        return null;
    if (request)
        return <div className='bt-q-inline'>{h(RequestView, { sessionId, bot, request, roster, actions })}</div>;
    if (done && /already saved/.test(contentText(content))) {
        return <div className='bt-event'><span className='bt-secret-event'>{h(KeyIcon)}{t('{bot} is using {name}', { bot: bot.name, name: name ?? t('a saved key') })}</span></div>;
    }
    return null;
}
export type CardCounts = Record<string, Record<string, number> | undefined>;
export type CardsHook = <T>(select: (state: CardCounts) => T) => T;
export interface SecretDockProps {
    sessionId: string;
    useRoster: <T>(select: (roster: SecretRoster) => T) => T;
    useCards?: CardsHook | undefined;
    useHeldCards?: CardsHook | undefined;
    actions: SecretActions;
}
// A card whose call the transcript does not draw (an earlier part of the chat, a
// hidden turn, a call outside the loaded history) waits above the composer instead.
// Once editing starts it keeps that component until completion or cancellation.
export function SecretDock({ sessionId, useRoster, useCards, useHeldCards, actions }: SecretDockProps) {
    const roster = useRoster(value => value);
    const shown = useCards?.(state => state[sessionId]) ?? NONE;
    const held = useHeldCards?.(state => state[sessionId]) ?? NONE;
    const bot = roster.byId[sessionId];
    if (!bot || currentPart(bot) !== sessionId)
        return null;
    const drawn = (entry: SecretRequest): boolean => entry.callId !== undefined && entry.callId !== '' && entry.sessionId === sessionId && (shown[entry.callId] ?? 0) > 0 && !((held[heldCardKey('secret', entry.id)] ?? 0) > 0);
    const waiting = (roster.secretRequests?.[bot.id] ?? []).filter(entry => entry.status === 'pending' && !drawn(entry));
    if (waiting.length === 0)
        return null;
    return <div className='bt-q-dock bt-secret-dock'>{waiting.map(request => h(SecretCard, { key: JSON.stringify([sessionId, request.id, request.kind]), sessionId, bot, request, roster, actions }))}</div>;
}
