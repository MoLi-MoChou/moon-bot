import { Fragment, createElement as h, useEffect, useState } from 'react';
import { t } from './i18n.ts';
// Settings → Tasks (2026-10-28 tasks-panel): who is working right now, for whom, and for
// how long; what finished lately; and the stop that ends one turn. The rows come from
// the host's tasks endpoint, which reads the live turns — this page only draws them and
// ticks the clocks once a second, so a stop shows up as the row leaving.
export interface TaskRunning {
    sessionId: string;
    botId: string;
    botName: string;
    since: number;
    roomId?: string;
    roomName?: string;
    tool?: string;
    target?: string;
    said?: string;
    switching?: boolean;
    fromName?: string;
}
export interface TaskDone {
    sessionId: string;
    botId: string;
    botName: string;
    startedAt: number;
    endedAt: number;
    reason: string;
    roomId?: string;
    roomName?: string;
    fromName?: string;
}
export interface TaskWaiting {
    botId: string;
    botName: string;
    for: readonly string[];
}
export interface TasksAnswer {
    running: readonly TaskRunning[];
    completed: readonly TaskDone[];
    waiting: readonly TaskWaiting[];
}
export interface TaskActions {
    tasks: () => Promise<TasksAnswer>;
    stopTask: (sessionId: string) => Promise<unknown>;
    openSession: (sessionId: string) => void;
}
/** mm:ss under an hour, h:mm:ss above it — the panel's clocks. */
export function elapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const two = (value: number): string => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
/** What a row says the Bot is doing, in the interface's words. */
export function doingText(task: TaskRunning, translate: (key: string, params?: Record<string, unknown>) => string = t): string {
    if (task.switching === true) return translate('Switching to a new session');
    if (task.tool !== undefined) return task.target === undefined ? translate('Running {tool}', { tool: task.tool }) : translate('Running {tool} on {target}', { tool: task.tool, target: task.target });
    if (task.said !== undefined) return task.said;
    return translate('Working');
}
const reasonText = (reason: string): string => reason === 'completed' ? t('Finished') : reason === 'error' ? t('Failed') : reason === 'user' ? t('Stopped') : t(reason);
export function TasksPage({ taskActions }: { taskActions: TaskActions }) {
    const [answer, setAnswer] = useState<TasksAnswer | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const refresh = (): void => {
        void taskActions.tasks().then(setAnswer).catch(failure => setError(failure?.message ?? String(failure)));
    };
    useEffect(() => {
        refresh();
        const timer = setInterval(() => { setNow(Date.now()); refresh(); }, 2000);
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => { clearInterval(timer); clearInterval(tick); };
    }, []);
    const stop = (task: TaskRunning): void => {
        setBusy(task.sessionId);
        setError(null);
        void taskActions.stopTask(task.sessionId).then(() => refresh()).catch(failure => setError(failure?.message ?? String(failure))).finally(() => setBusy(null));
    };
    const running = answer?.running ?? [];
    const completed = answer?.completed ?? [];
    const waiting = answer?.waiting ?? [];
    return <>
        <section className='bt-set-section'><h3>{t('Running')}</h3><div className='bt-set-card'>
            {answer === null ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Loading…')}</span></div>
                : running.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Nobody is working right now.')}</span></div>
                : running.map(task => <div key={task.sessionId} className='bt-task-row'>
                    <span className='bt-task-who'><span className='bt-task-name'>{task.botName}</span>
                        <span className='bt-task-sub'>{doingText(task)}{task.roomName !== undefined ? ` · ${task.roomName}` : ''}</span></span>
                    {task.fromName !== undefined ? <span className='bt-task-from'>{t('for {name}', { name: task.fromName })}</span> : null}
                    <span className='bt-task-clock' data-now={now}>{elapsed(now - task.since)}</span>
                    <button type='button' className='bt-soft bt-soft-sm' disabled={busy === task.sessionId} onClick={() => stop(task)}>{t('Stop')}</button>
                </div>)}
            {error !== null ? <div className='bt-connector-error' role='alert'>{error}</div> : null}
        </div></section>
        {waiting.length > 0 ? <section className='bt-set-section'><h3>{t('Waiting for another Bot')}</h3><div className='bt-set-card'>
            {waiting.map(entry => <div key={entry.botId} className='bt-task-row'><span className='bt-task-who'><span className='bt-task-name'>{entry.botName}</span>
                <span className='bt-task-sub'>{t('Waiting for {names}', { names: entry.for.join(', ') })}</span></span></div>)}
        </div></section> : null}
        <section className='bt-set-section'><h3>{t('Recently finished')}</h3><div className='bt-set-card'>
            {completed.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Nothing has finished yet.')}</span></div>
                : completed.map((task, index) => <button key={`${task.sessionId}:${task.endedAt}:${index}`} type='button' className='bt-task-row bt-task-done' onClick={() => taskActions.openSession(task.sessionId)}>
                    <span className='bt-task-who'><span className='bt-task-name'>{task.botName}</span>
                        <span className='bt-task-sub'>{reasonText(task.reason)}{task.fromName !== undefined ? ` · ${t('for {name}', { name: task.fromName })}` : ''}</span></span>
                    <span className='bt-task-clock'>{elapsed(task.endedAt - task.startedAt)}</span>
                </button>)}
        </div></section>
    </>;
}
export const TASKS_CSS = `
.bt-task-row{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:48px;border:0;background:none;width:100%;text-align:left;font:inherit;color:inherit}
.bt-task-done{cursor:pointer;border-radius:8px}
.bt-task-done:hover{background:var(--bt-hover)}
.bt-task-who{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-task-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-sub{font-size:11px;line-height:15px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-from{flex:none;font-size:11px;line-height:15px;color:var(--bt-ink-3)}
.bt-task-clock{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
`;
