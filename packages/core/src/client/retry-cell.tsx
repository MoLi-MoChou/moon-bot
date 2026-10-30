// Moon Bot: a model retry shows in the chat only while it waits, as one countdown line
// ("请求受限，3s 后重试 · 2/5"). Once the retry has run, the row leaves the chat and is
// listed in the turn's work process behind the "已工作" line.
import { createElement as h, useEffect, useMemo, useState } from 'react';
import { t } from './i18n.ts';
// One retry the model asked for, kept after the row leaves the chat so the turn's work
// process can list it. `maximum` is the mode's own cap, or '∞' for the normal mode.
export interface RetryEntry {
    seq: number;
    retry?: number | undefined;
    maximum?: number | string | undefined;
    cancelled: boolean;
    delayMs?: number | undefined;
    failure: string;
}
interface RetryFailure {
    code?: string;
    message?: string;
}
interface RetryCurrent {
    retry?: number;
    maximum?: number;
    retryState?: string;
    mode?: string;
    maxRetries?: number;
    delayMs?: number;
    seq?: number;
    time?: number;
    failure?: RetryFailure;
}
export interface RetryNode {
    data?: {
        current?: RetryCurrent;
        time?: number;
    };
    location?: {
        turn?: {
            turn?: number;
        };
    };
}
const retries = new Map<string, RetryEntry[]>();
const listeners = new Set<() => void>();
const keyOf = (sessionId: string, turn: number | undefined): string => `${sessionId}:${turn}`;
/** The settled retries of one turn, oldest first. */
export const turnRetries = (sessionId: string, turn: number | undefined): RetryEntry[] => retries.get(keyOf(sessionId, turn)) ?? [];
function noteRetry(sessionId: string, turn: number, entry: RetryEntry): void {
    const key = keyOf(sessionId, turn);
    const list = retries.get(key) ?? [];
    if (list.some(item => item.seq === entry.seq))
        return;
    if (retries.size > 500) {
        const oldest = retries.keys().next();
        if (!oldest.done)
            retries.delete(oldest.value);
    }
    retries.set(key, [...list, entry].sort((a, b) => a.seq - b.seq));
    for (const listener of listeners)
        listener();
}
export function useTurnRetries(sessionId: string, turn: number | undefined): RetryEntry[] {
    const [, bump] = useState(0);
    useEffect(() => {
        const listener = () => bump(n => n + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    return turnRetries(sessionId, turn);
}
const RATE = /RATE_LIMIT|429|rate/i;
export function RetryCell({ node, sessionId }: {
    node: RetryNode | undefined;
    sessionId: string;
}) {
    const current = node?.data?.current ?? {};
    const turn = node?.location?.turn?.turn;
    const waiting = current.retryState === 'scheduled';
    const maximum = current.mode === 'normal' ? current.maxRetries : '∞';
    const deadline = useMemo(() => Date.now() + (current.delayMs ?? 0), [current.delayMs, current.seq]);
    const [left, setLeft] = useState(() => Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
    useEffect(() => {
        if (!waiting)
            return;
        const tick = () => setLeft(Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
        tick();
        const timer = setInterval(tick, 250);
        return () => clearInterval(timer);
    }, [waiting, deadline]);
    useEffect(() => {
        if (waiting || turn === undefined)
            return;
        noteRetry(sessionId, turn, {
            seq: current.time ?? node?.data?.time ?? current.seq ?? 0,
            retry: current.retry,
            maximum,
            cancelled: current.retryState === 'cancelled',
            delayMs: current.delayMs,
            failure: [current.failure?.code, current.failure?.message].filter(Boolean).join(' · '),
        });
    }, [waiting, turn, sessionId, current.seq, current.retryState]);
    if (!waiting)
        return null;
    const limited = RATE.test(`${current.failure?.code ?? ''} ${current.failure?.message ?? ''}`);
    return <div className='bt-retry' role='status' title={current.failure?.message}><span className='bt-retry-dot' aria-hidden/><span>{limited ? t('Rate limited, retrying in {seconds}s', { seconds: left }) : t('Request failed, retrying in {seconds}s', { seconds: left })}</span><span className='bt-retry-n'>{`${current.retry}/${maximum}`}</span></div>;
}
export const RETRY_CSS = `
.bt-retry{display:inline-flex;align-items:center;gap:8px;margin:4px 0;padding:4px 10px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink-2);font-size:12.5px;font-variant-numeric:tabular-nums}
.bt-retry-dot{width:6px;height:6px;border-radius:50%;background:var(--bt-accent);animation:bt-retry-pulse 1.2s ease-in-out infinite}
.bt-retry-n{color:var(--bt-ink-3)}
@keyframes bt-retry-pulse{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.bt-retry-dot{animation:none}}
`;
