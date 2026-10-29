// Proactive messages: Settings → Proactive messages, and the review panel behind it.
//
// Two parts, because they answer different questions. The list is what the user subscribed
// to; the review is what the Bot would say today and whether it would actually send it. The
// review is the whole point of shipping this as a read-only surface first: without it the
// user has no way to judge whether a subscription is worth keeping.
import { createElement as h, useEffect, useState } from 'react';
import { t } from './i18n.ts';
import { ClockIcon, PlusIcon } from './icons.tsx';
import { EmptyState } from './empty-state.tsx';
import { Card } from './bot-settings.tsx';
import { PreAuthCard, type PreAuthActions } from './proactive-preauth.tsx';
import { outcomeText, quietLabel } from './proactive-copy.ts';

export interface Subscription {
    readonly id: string;
    readonly botId: string;
    readonly topics: string;
    readonly dailyCap: number;
    readonly quietFrom: string | null;
    readonly quietTo: string | null;
    readonly enabled: boolean;
    readonly eventHook: string | null;
    readonly eventMinutes: number | null;
}

export interface ReviewCandidate {
    readonly id: string;
    readonly text: string;
    readonly evidence: readonly string[];
    readonly whyCare: string;
    readonly ttl: 'short' | 'long';
    readonly would: 'send' | 'drop' | 'delay';
    readonly reason?: string | undefined;
}

export interface Review {
    readonly candidates: readonly ReviewCandidate[];
    readonly considered: number;
}

export interface ProactiveActions {
    proactiveList?: ((botId: string) => Promise<readonly Subscription[]>) | undefined;
    proactiveAdd: (input: { botId: string; topics: string; dailyCap: number; quietFrom: string | null; quietTo: string | null }) => Promise<unknown>;
    proactiveRemove: (id: string) => Promise<unknown>;
    proactiveEnable: (id: string, enabled: boolean) => Promise<unknown>;
    proactiveReview?: ((botId: string) => Promise<Review>) | undefined;
}

const inputValue = (event: { readonly target: EventTarget }): string => (event.target as HTMLInputElement).value;

function SubscriptionRow({ subscription, actions, onChange }: {
    subscription: Subscription;
    actions: ProactiveActions;
    onChange: () => void;
}) {
    const [confirming, setConfirming] = useState(false);
    const toggle = () => { void actions.proactiveEnable(subscription.id, !subscription.enabled).then(onChange, () => undefined); };
    const remove = () => {
        if (!confirming) { setConfirming(true); return; }
        void actions.proactiveRemove(subscription.id).then(onChange, () => undefined);
    };
    return <li className='bt-pro-row'>
        <div className='bt-pro-row-copy'>
            <span className='bt-pro-topics'>{subscription.topics}</span>
            <span className='bt-pro-meta'>
                {t('At most {count} a day', { count: subscription.dailyCap })}
                {' · '}
                {quietLabel(subscription)}
                {subscription.eventHook === null ? null : ` · ${t('Also when nothing moves for {count} min', { count: subscription.eventMinutes ?? 0 })}`}
            </span>
        </div>
        <button type='button' className='bt-soft bt-soft-sm' aria-pressed={subscription.enabled} onClick={toggle}>
            {subscription.enabled ? t('On') : t('Off')}
        </button>
        <button type='button' className='bt-soft bt-soft-sm bt-pro-danger' onClick={remove} onBlur={() => setConfirming(false)}>
            {confirming ? t('Confirm') : t('Remove')}
        </button>
    </li>;
}

function SubscribeForm({ botId, actions, onDone }: { botId: string; actions: ProactiveActions; onDone: () => void }) {
    const [topics, setTopics] = useState('');
    const [cap, setCap] = useState('1');
    const [from, setFrom] = useState('22:00');
    const [to, setTo] = useState('08:00');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = (event: { preventDefault(): void }) => {
        event.preventDefault();
        const subject = topics.trim();
        // A subscription with no subject has nothing to watch and would only spend requests.
        if (subject === '') { setError(t('Say what this Bot should keep an eye on.')); return; }
        setBusy(true);
        setError(null);
        void actions.proactiveAdd({
            botId, topics: subject,
            dailyCap: Number(cap) || 1,
            quietFrom: from === '' ? null : from,
            quietTo: to === '' ? null : to,
        }).then(() => { setTopics(''); setBusy(false); onDone(); }, (problem: unknown) => {
            setBusy(false);
            setError(problem instanceof Error ? problem.message : t('That did not work.'));
        });
    };
    return <form className='bt-pro-form' onSubmit={submit}>
        <label className='bt-pro-field'>
            <span className='bt-pro-label'>{t('What should it keep an eye on?')}</span>
            <input value={topics} onChange={event => setTopics(inputValue(event))} placeholder={t('my work, the deploy, the weekly report')} />
        </label>
        <div className='bt-pro-inline'>
            <label className='bt-pro-field bt-pro-narrow'>
                <span className='bt-pro-label'>{t('At most a day')}</span>
                <input type='number' min='1' max='5' value={cap} onChange={event => setCap(inputValue(event))} />
            </label>
            <label className='bt-pro-field bt-pro-narrow'>
                <span className='bt-pro-label'>{t('Quiet from')}</span>
                <input type='time' value={from} onChange={event => setFrom(inputValue(event))} />
            </label>
            <label className='bt-pro-field bt-pro-narrow'>
                <span className='bt-pro-label'>{t('Quiet to')}</span>
                <input type='time' value={to} onChange={event => setTo(inputValue(event))} />
            </label>
        </div>
        {error === null ? null : <div className='bt-pro-error' role='alert'>{error}</div>}
        <button type='submit' className='bt-soft bt-soft-sm' disabled={busy}>{busy ? t('Saving…') : t('Turn on proactive messages')}</button>
    </form>;
}

function ReviewPanel({ botId, actions }: { botId: string; actions: ProactiveActions }) {
    const [review, setReview] = useState<Review | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = () => {
        if (actions.proactiveReview === undefined) return;
        setBusy(true);
        setError(null);
        void actions.proactiveReview(botId).then((next) => { setReview(next); setBusy(false); }, (problem: unknown) => {
            setBusy(false);
            setError(problem instanceof Error ? problem.message : t('That did not work.'));
        });
    };
    return <section className='bt-pro-review'>
        <div className='bt-pro-review-head'>
            <span className='bt-pro-label'>{t('Look back over today')}</span>
            <button type='button' className='bt-soft bt-soft-sm' onClick={run} disabled={busy}>
                {busy ? t('Looking…') : t('Review now')}
            </button>
        </div>
        <p className='bt-pro-hint'>{t('This only shows what the Bot would say. Nothing is sent.')}</p>
        {error === null ? null : <div className='bt-pro-error' role='alert'>{error}</div>}
        {review === null ? null : review.candidates.length === 0
            ? <p className='bt-pro-hint'>{t('Nothing worth bringing up today.')}</p>
            : <ul className='bt-pro-candidates'>
                {review.candidates.map(candidate => <li key={candidate.id} className='bt-pro-candidate'>
                    <p className='bt-pro-candidate-text'>{candidate.text}</p>
                    <p className='bt-pro-candidate-why'>{candidate.whyCare}</p>
                    <ul className='bt-pro-evidence'>
                        {candidate.evidence.map(line => <li key={line}>{line}</li>)}
                    </ul>
                    <span className='bt-pro-outcome' data-would={candidate.would}>{outcomeText(candidate)}</span>
                </li>)}
            </ul>}
    </section>;
}

export function ProactivePage({ botId, actions }: { botId: string; actions: ProactiveActions }) {
    const [subscriptions, setSubscriptions] = useState<readonly Subscription[] | null>(null);
    const [adding, setAdding] = useState(false);
    const load = () => {
        void (actions.proactiveList?.(botId) ?? Promise.resolve([])).then(setSubscriptions, () => setSubscriptions([]));
    };
    useEffect(load, [botId]);
    if (actions.proactiveList === undefined) {
        return <EmptyState icon={<ClockIcon />} title={t('Proactive messages are off')} hint={t('This host does not send them.')} />;
    }
    return <div className='bt-pro'>
        <p className='bt-pro-hint'>{t('A Bot can come back to something on its own, within limits you set. It stays silent unless you turn this on.')}</p>
        {subscriptions === null ? null : subscriptions.length === 0
            ? <EmptyState icon={<ClockIcon />} title={t('Nothing set up yet')} hint={t('Add one below and the Bot will start looking for things worth telling you.')} />
            : <ul className='bt-pro-list'>
                {subscriptions.map(subscription => <li key={subscription.id} className='bt-pro-block'>
                    <SubscriptionRow subscription={subscription} actions={actions} onChange={load} />
                    <PreAuthCard botId={botId} subscriptionId={subscription.id} actions={actions as unknown as PreAuthActions} />
                </li>)}
            </ul>}
        {adding
            ? <SubscribeForm botId={botId} actions={actions} onDone={() => { setAdding(false); load(); }} />
            : <button type='button' className='bt-soft bt-soft-sm bt-pro-add' onClick={() => setAdding(true)}>
                <PlusIcon /> {t('Add a subscription')}
            </button>}
        {subscriptions === null || subscriptions.length === 0 ? null : <ReviewPanel botId={botId} actions={actions} />}
    </div>;
}

/** The card in a Bot's settings: what it watches, and the review that shows it working. */
export function ProactiveCard({ botId, actions }: { botId: string; actions: ProactiveActions }) {
    return <Card title={t('Proactive messages')}>
        <div className='bt-pro-card'>
            <ProactivePage botId={botId} actions={actions} />
        </div>
    </Card>;
}
