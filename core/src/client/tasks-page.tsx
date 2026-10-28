import { Fragment, createElement as h, useEffect, useState } from 'react';
import { t } from './i18n.ts';
import { SPRING_SHAPE } from './motion.tsx';
// Settings → Tasks and the sidebar's task popover (2026-10-28 tasks-panel): who is
// working right now, for whom, and for how long; what waits in its queue; what finished
// lately; and the stop that ends one turn. The rows come from the host's tasks endpoint,
// which reads the live turns and the queue behind each one — this page only draws them,
// ticks the clocks once a second, and marks a row stopped the moment the user asks.
// `useTasks` keeps the polling and the stop state; `TasksBoard` is the one rendering the
// Settings page and the popover share.
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
    /** Messages waiting behind the running turn; the host leaves the field out at zero. */
    queued?: number;
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
/** What `task-stop` answers: whether a running turn was there to cancel. */
export interface TaskStopAnswer {
    readonly stopped?: boolean;
}
export interface TaskActions {
    tasks: () => Promise<TasksAnswer>;
    stopTask: (sessionId: string) => Promise<TaskStopAnswer | undefined>;
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
/** Why a finished row ended, saying who ended it: a user's stop and a Main Bot's differ. */
export function reasonText(reason: string): string {
    if (reason === 'completed') return t('Finished');
    if (reason === 'error') return t('Failed');
    if (reason === 'user') return t('Stopped by you');
    if (reason === 'hook') return t('Stopped by a Main Bot');
    // The engine reports a cancelled turn with the abort reason; the panel's Stop is it.
    if (reason === 'aborted' || reason === 'disposed') return t('Stopped');
    return t(reason);
}
/** One running turn: the same Session's next turn starts at a new time, so a stop's
 *  mark belongs to this turn, not to the Session. */
const turnKey = (task: TaskRunning): string => `${task.sessionId}:${task.since}`;
export interface TasksState {
    readonly answer: TasksAnswer | null;
    readonly now: number;
    readonly busy: string | null;
    /** Turns the user just stopped, by Session and start time: they read stopped until gone. */
    readonly stopped: ReadonlySet<string>;
    readonly notice: string | null;
    readonly error: string | null;
    readonly refresh: () => void;
    readonly stop: (task: TaskRunning) => void;
}
/** The endpoint's polling and the stop's feedback, shared by the page and the popover. */
export function useTasks(taskActions: TaskActions): TasksState {
    const [answer, setAnswer] = useState<TasksAnswer | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [busy, setBusy] = useState<string | null>(null);
    const [stopped, setStopped] = useState<ReadonlySet<string>>(() => new Set());
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const refresh = (): void => {
        void taskActions.tasks().then(next => {
            setAnswer(next);
            // A stopped row leaves with its turn; a turn that starts after it (a queued
            // message) is a different one and is not marked.
            setStopped(marked => new Set([...marked].filter(key => (next.running ?? []).some(task => turnKey(task) === key))));
        }).catch(failure => setError(failure?.message ?? String(failure)));
    };
    useEffect(() => {
        refresh();
        const poll = setInterval(() => { setNow(Date.now()); refresh(); }, 2000);
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => { clearInterval(poll); clearInterval(tick); };
    }, []);
    const stop = (task: TaskRunning): void => {
        setBusy(task.sessionId);
        setNotice(null);
        setError(null);
        void taskActions.stopTask(task.sessionId).then(result => {
            // The turn may have ended between the panel's poll and the click; say so
            // instead of pretending something was stopped.
            if (result?.stopped === false) {
                setNotice(t('{name} had already finished, so nothing was stopped.', { name: task.botName }));
                refresh();
                return;
            }
            setStopped(marked => new Set([...marked, turnKey(task)]));
            refresh();
        }).catch(failure => setError(failure?.message ?? String(failure))).finally(() => setBusy(null));
    };
    return { answer, now, busy, stopped, notice, error, refresh, stop };
}
export interface TasksBoardProps {
    readonly state: TasksState;
    readonly onOpen: (sessionId: string) => void;
}
/** Who is working, who waits, what finished lately — the sections both surfaces draw. */
export function TasksBoard({ state, onOpen }: TasksBoardProps) {
    const { answer, now, busy, stopped, notice, error, stop } = state;
    const running = answer?.running ?? [];
    const completed = answer?.completed ?? [];
    const waiting = answer?.waiting ?? [];
    return <>
        {notice !== null ? <div className='bt-tasks-notice' role='status'>{notice}</div> : null}
        {error !== null ? <div className='bt-connector-error' role='alert'>{error}</div> : null}
        <section className='bt-set-section'><h3>{t('Running')}</h3><div className='bt-set-card'>
            {answer === null ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Loading…')}</span></div>
                : running.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Nobody is working right now.')}</span></div>
                : running.map(task => {
                    const isStopped = stopped.has(turnKey(task));
                    return <div key={task.sessionId} className='bt-task-row' data-stopped={isStopped || undefined}>
                        <button type='button' className='bt-task-who' onClick={() => onOpen(task.sessionId)}>
                            <span className='bt-task-name'>{task.botName}</span>
                            <span className='bt-task-sub'>{doingText(task)}{task.roomName !== undefined ? ` · ${task.roomName}` : ''}</span>
                        </button>
                        {task.fromName !== undefined ? <span className='bt-task-from'>{t('for {name}', { name: task.fromName })}</span> : null}
                        {task.queued !== undefined && task.queued > 0
                            ? <span className='bt-task-queued' title={t('Messages waiting for the next turn')}>{t('{count} queued', { count: task.queued })}</span>
                            : null}
                        <span className='bt-task-clock'>{elapsed(now - task.since)}</span>
                        {isStopped ? <span className='bt-task-state'>{t('Stopped by you')}</span>
                            : <button type='button' className='bt-soft bt-soft-sm bt-task-stop' disabled={busy === task.sessionId}
                                title={t('Stop {name}', { name: task.botName })}
                                aria-label={t('Stop {name}', { name: task.botName })}
                                onClick={() => stop(task)}>{busy === task.sessionId ? t('Stopping…') : t('Stop')}</button>}
                    </div>;
                })}
        </div></section>
        {waiting.length > 0 ? <section className='bt-set-section'><h3>{t('Waiting for another Bot')}</h3><div className='bt-set-card'>
            {waiting.map(entry => <div key={entry.botId} className='bt-task-row'><span className='bt-task-who'><span className='bt-task-name'>{entry.botName}</span>
                <span className='bt-task-sub'>{t('Waiting for {names}', { names: entry.for.join(', ') })}</span></span></div>)}
        </div></section> : null}
        <section className='bt-set-section'><h3>{t('Recently finished')}</h3><div className='bt-set-card'>
            {completed.length === 0 ? <div className='bt-set-row'><span className='bt-set-hint'>{t('Nothing has finished yet.')}</span></div>
                : completed.map((task, index) => <button key={`${task.sessionId}:${task.endedAt}:${index}`} type='button' className='bt-task-row bt-task-done' onClick={() => onOpen(task.sessionId)}>
                    <span className='bt-task-who'><span className='bt-task-name'>{task.botName}</span>
                        <span className='bt-task-sub'>{reasonText(task.reason)}{task.fromName !== undefined ? ` · ${t('for {name}', { name: task.fromName })}` : ''}</span></span>
                    <span className='bt-task-clock'>{elapsed(task.endedAt - task.startedAt)}</span>
                </button>)}
        </div></section>
    </>;
}
/** Settings → Tasks: the same board as a page. */
export function TasksPage({ taskActions }: { taskActions: TaskActions }) {
    const state = useTasks(taskActions);
    return <TasksBoard state={state} onOpen={taskActions.openSession} />;
}
export const TASKS_CSS = `
.bt-task-row{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:48px;border:0;background:none;width:100%;text-align:left;font:inherit;color:inherit}
.bt-task-done{cursor:pointer;border-radius:8px}
.bt-task-done:hover{background:var(--bt-hover)}
.bt-task-row[data-stopped]{opacity:.65}
.bt-task-who{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:8px}
button.bt-task-who:hover .bt-task-name{color:var(--bt-accent)}
.bt-task-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-sub{font-size:11px;line-height:15px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-from{flex:none;font-size:11px;line-height:15px;color:var(--bt-ink-3)}
.bt-task-queued{flex:none;font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-task-state{flex:none;font-size:11px;line-height:16px;color:var(--bt-ink-3);white-space:nowrap}
.bt-task-clock{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-task-stop{flex:none;color:var(--bt-warn)}
.bt-task-stop:hover:not(:disabled){background:color-mix(in srgb,var(--bt-warn) 12%,var(--bt-hover))}
.bt-tasks-notice{padding:8px 12px;border-radius:10px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:12px;line-height:16px}
.bt-pending-queued{align-self:flex-end;padding:1px 8px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);font-size:11px;line-height:16px;white-space:nowrap}
/* The sidebar's task popover: the same sections in a dialog over the conversation. */
.bt-tasks-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:60;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-tasks{position:relative;width:min(460px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 2*max(24px,var(--dsh-frame-overlay-top,24px))));background:var(--bt-main);border-radius:16px;border:.5px solid var(--bt-line-2);box-shadow:0 24px 80px var(--bt-line),0 0 0 .5px var(--bt-line-2);display:flex;flex-direction:column;overflow:hidden;color:var(--bt-ink);animation:bt-dialog-rise ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-tasks:focus-visible{outline:none}
.bt-tasks-head{display:flex;align-items:center;gap:8px;height:60px;flex:none;padding:0 12px 0 18px;border-bottom:.5px solid var(--bt-line);box-sizing:border-box}
.bt-tasks-head .bt-icon-btn{width:32px;height:32px;flex:none}
.bt-tasks-icon{display:inline-flex;flex:none;color:var(--bt-ink-2)}
.bt-tasks-title{margin:0;font-size:16px;line-height:24px;font-weight:600;white-space:nowrap}
.bt-tasks-status{flex:1;min-width:0;font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-tasks-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px 18px;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin}
@media (max-width:640px){.bt-task-from{display:none}.bt-tasks{width:100vw;height:100%;max-height:100%;border-radius:0;border:0}.bt-tasks-body{padding:12px 12px 20px}}
@media (prefers-reduced-motion:reduce){.bt-tasks{animation:bt-fade .12s ease-out!important}}
`;
