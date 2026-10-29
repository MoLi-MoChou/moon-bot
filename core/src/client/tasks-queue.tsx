import { createElement as h } from 'react';
import { t } from './i18n.ts';
// The lines waiting behind a running turn (2026-10-29 session-queue). The host sends
// a short preview and an id; withdrawing one does not stop the turn that is running.
export interface TaskQueueItem {
    readonly id: string;
    readonly preview: string;
}
export function TaskQueue({ sessionId, items, busy, onWithdraw }: {
    readonly sessionId: string;
    readonly items: readonly TaskQueueItem[] | undefined;
    readonly busy: string | null;
    readonly onWithdraw?: ((sessionId: string, id: string) => void) | undefined;
}) {
    if (items === undefined || items.length === 0) return null;
    return <ul className='bt-task-queue'>
        {items.map(item => {
            const label = item.preview === '' ? t('Queued message') : item.preview;
            const pending = busy === `queue:${item.id}`;
            return <li key={item.id} className='bt-task-queue-line'>
                <span className='bt-task-queue-text'>{label}</span>
                {onWithdraw === undefined ? null : <button type='button' className='bt-soft bt-soft-sm' disabled={pending} aria-label={t('Withdraw {preview}', { preview: label })} onClick={() => onWithdraw(sessionId, item.id)}>{pending ? t('Withdrawing…') : t('Withdraw')}</button>}
            </li>;
        })}
    </ul>;
}
