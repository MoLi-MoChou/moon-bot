import { createElement as h, useState } from 'react';
import { t } from './i18n.ts';
import { ChevronRightIcon } from './icons.tsx';
import { Card } from './kit/index.ts';

// Resetting a Bot (docs/plans/2026-10-29-reset-bot.md): four independent parts, and the
// consequences listed before anything happens. Defaults to memory only, because that is
// the question people actually ask ("forget everything"), and it is the least to lose.
export interface ResetTarget {
    readonly id: string;
    readonly name: string;
}
export interface ResetActions {
    resetBot: (id: string, parts: Record<string, boolean>) => Promise<{ done: readonly string[]; failed: readonly { part: string; reason: string }[] } | undefined>;
}
interface Part {
    readonly key: 'memory' | 'conversation' | 'history' | 'identity';
    readonly label: string;
    readonly hint: string;
    /** What is lost, said plainly: this is the list the panel shows before confirming. */
    readonly loss: string;
    readonly retryable: boolean;
}
const PARTS: readonly Part[] = [
    {
        key: 'memory',
        label: 'Forget everything it learned',
        hint: 'Its memory: the notes it keeps and the topics they live in.',
        loss: 'Everything this Bot remembered — facts about you, decisions, preferences — is deleted. It cannot be recovered.',
        retryable: false,
    },
    {
        key: 'conversation',
        label: 'Start the conversation over',
        hint: 'Clears what it can see of this chat. Earlier parts stay in the history.',
        loss: 'The conversation it reads next turn is empty, as if you had just met.',
        retryable: false,
    },
    {
        key: 'history',
        label: 'Delete the conversation history',
        hint: 'Its own chat and what it said in group chats.',
        loss: 'The messages are deleted, not archived. The chat shows as empty.',
        retryable: false,
    },
    {
        key: 'identity',
        label: 'Restore its default settings',
        hint: 'Role, instructions, model, thinking level, permission preset, avatar and working folder.',
        loss: 'Those settings go back to the defaults. Its name stays, and it stays in its groups.',
        retryable: false,
    },
];

export function BotResetCard({ bot, actions, run }: {
    bot: ResetTarget;
    actions: ResetActions;
    run: (work: Promise<unknown>) => Promise<boolean>;
}) {
    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState<Record<string, boolean>>({ memory: true });
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const chosen = PARTS.filter(part => picked[part.key] === true);
    const toggle = (key: Part['key']) => {
        setConfirming(false);
        setPicked(current => ({ ...current, [key]: current[key] !== true }));
    };
    const reset = async () => {
        if (chosen.length === 0) return;
        setError(null);
        const answer = await actions.resetBot(bot.id, picked);
        await run(Promise.resolve(answer));
        const failed = answer?.failed ?? [];
        if (failed.length > 0) setError(failed.map(item => item.reason).join(' '));
        else {
            setOpen(false);
            setConfirming(false);
            setPicked({ memory: true });
        }
    };
    return (
        <Card title={t('Reset this Bot')}>
            <button type='button' className='bt-set-row bt-bs-row' aria-expanded={open} onClick={() => { setOpen(!open); setConfirming(false); setError(null); }}>
                <span className='bt-set-copy'>
                    <span className='bt-bs-label'>{t('Reset {name}', { name: bot.name })}</span>
                    <span className='bt-set-hint'>{t('Clear what it remembers, or start it over. You choose what goes.')}</span>
                </span>
                <span className='bt-chevron'><ChevronRightIcon /></span>
            </button>
            {open ? <div className='bt-reset-panel'>
                {PARTS.map(part => <label key={part.key} className='bt-reset-part'>
                    <input type='checkbox' checked={picked[part.key] === true} onChange={() => toggle(part.key)} />
                    <span className='bt-reset-copy'>
                        <span className='bt-reset-label'>{t(part.label)}</span>
                        <span className='bt-set-hint'>{t(part.hint)}</span>
                    </span>
                </label>)}
                {chosen.length === 0
                    ? <div className='bt-set-hint'>{t('Pick at least one thing to reset.')}</div>
                    : <div className='bt-reset-loss' role='note'>
                        <span className='bt-reset-loss-title'>{t('This will:')}</span>
                        {chosen.map(part => <span key={part.key} className='bt-reset-loss-line'>{t(part.loss)}</span>)}
                    </div>}
                {error !== null ? <div className='bt-set-hint bt-bs-danger' role='alert'>{error}</div> : null}
                {confirming
                    ? <div className='bt-reset-confirm'>
                        <span className='bt-reset-question'>{t('Reset {name} now? This cannot be undone.', { name: bot.name })}</span>
                        <button type='button' className='bt-soft bt-soft-sm bt-bs-danger' onClick={() => { void reset(); }}>{t('Yes, reset')}</button>
                        <button type='button' className='bt-soft bt-soft-sm' onClick={() => setConfirming(false)}>{t('Cancel')}</button>
                    </div>
                    : <button type='button' className='bt-soft bt-soft-sm bt-bs-danger' disabled={chosen.length === 0} onClick={() => setConfirming(true)}>{t('Reset this Bot…')}</button>}
            </div> : null}
        </Card>
    );
}
