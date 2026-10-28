// Scheduled tasks: Settings → Scheduled tasks, a Bot's card in its settings, and the
// line in its details panel. DSH runs the tasks (see src/host/schedules.tsx); a task
// sends its prompt to the Bot's chat when it is due.
import { Fragment, createElement as h, useEffect, useState } from 'react';
import { BotAvatar, RoomAvatar } from './mark.tsx';
import { ClockIcon, PlusIcon, TrashIcon } from './icons.tsx';
import { Segmented } from './motion.tsx';
import { EmptyState } from './empty-state.tsx';
import { dateLocale, hostText, t } from './i18n.ts';
import type { FormEvent, ReactNode } from 'react';
import type { MarkBot } from './mark.tsx';
/** One scheduled task, as the host reports it. */
interface Task {
    readonly id: string;
    readonly sessionId: string;
    readonly botId?: string | undefined;
    readonly roomId?: string | undefined;
    readonly title: string;
    readonly prompt?: string | undefined;
    readonly kind?: string | undefined;
    readonly status?: string | undefined;
    readonly scheduledAt?: string | undefined;
    readonly time?: string | undefined;
    readonly everySeconds?: number | undefined;
    readonly weekdays?: readonly number[] | undefined;
    readonly expression?: string | undefined;
    readonly timeZone?: string | undefined;
}
/** What the tasks view says: whether DSH runs them at all, and the tasks themselves. */
interface ScheduleView {
    readonly available: boolean;
    readonly tasks: readonly Task[];
}
interface ScheduleRoom {
    readonly id: string;
    readonly name: string;
    readonly members: readonly string[];
}
interface ScheduleRoster {
    readonly bots: readonly {
        readonly id: string;
        readonly name: string;
    }[];
    readonly rooms: readonly ScheduleRoom[];
    readonly byId: Record<string, MarkBot | undefined>;
    readonly roomsById: Record<string, ScheduleRoom | undefined>;
}
interface ScheduleActions {
    schedules?: (() => Promise<ScheduleView>) | undefined;
    scheduleDelete: (sessionId: string, id: string) => Promise<unknown>;
    scheduleCreate: (input: {
        target: string;
        title: string;
        prompt: string;
        when: Record<string, unknown>;
    }) => Promise<unknown>;
    openShellSettingsPanel?: (() => void) | undefined;
    openSettings: (page: string, id?: string | null) => void;
}
type ScheduleListener = (view: ScheduleView) => void;
const inputValue = (event: {
    readonly target: EventTarget;
}): string => (event.target as HTMLInputElement).value;
const POLL_MS = 30000;
// One view for every surface that shows tasks; each asks again when it mounts.
let shared: ScheduleView | null = null;
const listeners = new Set<ScheduleListener>();
function publish(view: ScheduleView): void {
    shared = view;
    for (const listener of listeners)
        listener(view);
}
export function useSchedules(actions: ScheduleActions): ScheduleView | null {
    const [view, setView] = useState<ScheduleView | null>(shared);
    useEffect(() => {
        listeners.add(setView);
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = (): void => {
            void (actions.schedules?.() ?? Promise.resolve(null))
                .then((next) => { if (!stopped && next !== null)
                publish(next); })
                .catch(() => { })
                .finally(() => { if (!stopped)
                timer = setTimeout(load, POLL_MS); });
        };
        load();
        return () => { stopped = true; clearTimeout(timer); listeners.delete(setView); };
    }, []);
    return view;
}
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = (time: unknown): string => String(time ?? '').slice(0, 5);
const when = (ms: number, options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(dateLocale(), options).format(ms);
function dayAndTime(ms: number): string {
    const sameYear = new Date(ms).getFullYear() === new Date().getFullYear();
    return when(ms, { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function weekdayNames(days: readonly number[]): string {
    const names = days.map(day => when(Date.UTC(2024, 0, day), { weekday: 'short', timeZone: 'UTC' }));
    return names.join(dateLocale().startsWith('zh') ? '、' : ', ');
}
function everyText(seconds: number): string {
    if (seconds % 86400 === 0)
        return seconds === 86400 ? t('Every day') : t('Every {count} days', { count: seconds / 86400 });
    if (seconds % 3600 === 0)
        return seconds === 3600 ? t('Every hour') : t('Every {count} hours', { count: seconds / 3600 });
    return t('Every {count} minutes', { count: Math.round(seconds / 60) });
}
// How often a task runs, in the user's words.
export function timingText(task: Task): string {
    const zone = task.timeZone && task.timeZone !== localZone() ? ` (${task.timeZone})` : '';
    switch (task.kind) {
        case 'after':
        case 'at': return t('Once, {time}', { time: dayAndTime(Date.parse(task.scheduledAt as string)) });
        case 'every': return everyText(task.everySeconds as number);
        case 'daily': return `${t('Every day at {time}', { time: clock(task.time) })}${zone}`;
        case 'weekly': {
            const days = (task.weekdays ?? []).join();
            const text = days === '1,2,3,4,5' ? t('Every weekday at {time}', { time: clock(task.time) })
                : days === '6,7' ? t('Every weekend at {time}', { time: clock(task.time) })
                    : days === '1,2,3,4,5,6,7' ? t('Every day at {time}', { time: clock(task.time) })
                        : t('Every {days} at {time}', { days: weekdayNames(task.weekdays ?? []), time: clock(task.time) });
            return `${text}${zone}`;
        }
        case 'cron': return `${t('On the schedule {expression}', { expression: task.expression as string })}${zone}`;
        default: return '';
    }
}
const nextText = (task: Task): string => (task.status === 'active' ? t('Next: {time}', { time: dayAndTime(Date.parse(task.scheduledAt as string)) }) : t('Finished'));
function TaskRow({ task, actions, onView, showBot, roster }: {
    task: Task;
    actions: ScheduleActions;
    onView: ScheduleListener;
    showBot?: boolean | undefined;
    roster: ScheduleRoster;
}) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!confirming)
            return undefined;
        const timer = setTimeout(() => setConfirming(false), 3000);
        return () => clearTimeout(timer);
    }, [confirming]);
    const remove = (): void => {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setBusy(true);
        void actions.scheduleDelete(task.sessionId, task.id).then((next) => onView(next as ScheduleView), () => setBusy(false));
    };
    const room = task.roomId === undefined ? undefined : roster.roomsById[task.roomId];
    return <div className='bt-set-row bt-task' data-done={task.status === 'active' ? undefined : ''} data-busy={busy || undefined}>{showBot ? <BotAvatar bot={task.botId === undefined ? undefined : roster.byId[task.botId]} size={28} badge={false} live={false} /> : null}<span className='bt-set-copy'><span className='bt-task-title'>{task.title}</span><span className='bt-set-hint'>{[timingText(task), room ? t('in {name}', { name: room.name }) : ''].filter(Boolean).join(' · ')}</span>{task.prompt && task.prompt !== task.title ? <span className='bt-task-prompt'>{task.prompt}</span> : null}</span><span className='bt-task-next'>{nextText(task)}</span><button type='button' className='bt-mini bt-task-remove' data-confirm={confirming || undefined} disabled={busy} aria-label={confirming ? t('Click again to delete') : t('Delete task')} title={confirming ? undefined : t('Delete task')} onClick={remove}>{confirming ? t('Delete') : <TrashIcon />}</button></div>;
}
const pad = (number: number): string => String(number).padStart(2, '0');
function inAnHour(): string {
    const date = new Date(Date.now() + 3600000);
    date.setMinutes(0, 0, 0);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}
const KINDS: readonly (readonly [
    string,
    string
])[] = [['at', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['every', 'Repeat']];
const UNITS: readonly (readonly [
    string,
    number,
    string
])[] = [['minutes', 1, 'minutes'], ['hours', 60, 'hours'], ['days', 1440, 'days']];
function TaskForm({ roster, actions, start, onDone, onCancel }: {
    roster: ScheduleRoster;
    actions: ScheduleActions;
    start: string | undefined;
    onDone: ScheduleListener;
    onCancel: () => void;
}) {
    // A task goes to a Bot's chat or to a group chat, where it reads as your message.
    const [target, setTarget] = useState(start ?? roster.bots[0]?.id ?? '');
    const [title, setTitle] = useState('');
    const [prompt, setPrompt] = useState('');
    const [kind, setKind] = useState('daily');
    const [at, setAt] = useState(inAnHour);
    const [time, setTime] = useState('09:00');
    const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [count, setCount] = useState<string | number>(1);
    const [unit, setUnit] = useState('hours');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const timing = () => {
        if (kind === 'at')
            return { kind, at: new Date(at).toISOString() };
        if (kind === 'every')
            return { kind, minutes: Math.round(Number(count) * (UNITS.find(([id]) => id === unit)?.[1] ?? 1)) };
        return { kind, time, timeZone: localZone(), ...(kind === 'weekly' ? { weekdays } : {}) };
    };
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setError('');
        let when: Record<string, unknown>;
        try {
            when = timing();
        }
        catch {
            setError(t('Pick a date and time'));
            setBusy(false);
            return;
        }
        void actions.scheduleCreate({ target, title, prompt, when })
            .then((next) => onDone(next as ScheduleView), (failure: {
            readonly message?: string;
        } | null | undefined) => { setError(hostText(failure?.message ?? String(failure))); setBusy(false); });
    };
    const toggleDay = (day: number): void => setWeekdays(days => (days.includes(day) ? days.filter(item => item !== day) : [...days, day].sort()));
    return <form className='bt-set-card bt-task-form' onSubmit={submit}><label className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Send to')}</span></span><select className='bt-select bt-task-bot' value={target} onChange={event => setTarget(inputValue(event))}><optgroup label={t('Bots')}>{roster.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</optgroup>{roster.rooms.length > 0 ? <optgroup label={t('Group chats')}>{roster.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</optgroup> : null}</select></label><label className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Name')}</span></span><input className='bt-bs-input' value={title} maxLength={120} placeholder={t('Morning briefing')} autoFocus onChange={event => setTitle(inputValue(event))}/></label><label className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{t('What to do')}</span></span><textarea className='bt-bs-input bt-bs-area' value={prompt} rows={3} placeholder={t('Sum up what changed since yesterday and what needs me today.')} onChange={event => setPrompt(inputValue(event))}/></label><div className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label'>{t('When')}</span></span><Segmented label={t('When')} value={kind}>{KINDS.map(([id, label]) => <button key={id} type='button' aria-pressed={kind === id} onClick={() => setKind(id)}>{t(label)}</button>)}</Segmented><div key={kind} className='bt-task-when bt-veil'>{kind === 'at' ? <input className='bt-input' type='datetime-local' value={at} aria-label={t('Date and time')} onChange={event => setAt(inputValue(event))}/> : null}{kind === 'weekly' ? <div className='bt-task-days' role='group' aria-label={t('Days')}>{[1, 2, 3, 4, 5, 6, 7].map(day => <button key={day} type='button' className='bt-task-day' aria-pressed={weekdays.includes(day)} onClick={() => toggleDay(day)}>{when(Date.UTC(2024, 0, day), { weekday: 'narrow', timeZone: 'UTC' })}</button>)}</div> : null}{kind === 'daily' || kind === 'weekly' ? <input className='bt-input bt-task-time' type='time' value={time} aria-label={t('Time')} onChange={event => setTime(inputValue(event))}/> : null}{kind === 'every' ? <><span className='bt-task-every'>{t('Every')}</span><input className='bt-input bt-task-count' type='number' min={1} value={count} aria-label={t('How many')} onChange={event => setCount(inputValue(event))}/><select className='bt-select bt-task-unit' value={unit} aria-label={t('Unit')} onChange={event => setUnit(inputValue(event))}>{UNITS.map(([id, , label]) => <option key={id} value={id}>{t(label)}</option>)}</select></> : null}</div></div>{error ? <div className='bt-set-row'><span className='bt-danger bt-set-hint'>{error}</span></div> : null}<div className='bt-set-row bt-task-foot'><button type='button' className='bt-soft bt-soft-sm' onClick={onCancel}>{t('Cancel')}</button><button type='submit' className='bt-send bt-soft-sm' disabled={busy || !target || title.trim() === '' || prompt.trim() === ''}>{busy ? t('Creating…') : t('Create task')}</button></div></form>;
}
// Settings has no schedule service to show: Automation tasks are off in DSH.
function AutomationOff({ actions }: {
    actions: ScheduleActions;
}) {
    return <div className='bt-set-card bt-task-off'><EmptyState icon={<ClockIcon />} title={t('Turn on scheduled tasks')} hint={t('Scheduled tasks are turned off for this Bot.')} {...(actions.openShellSettingsPanel ? { action: { label: t('Open settings'), onClick: actions.openShellSettingsPanel } } : {})} /></div>;
}
export function SchedulesPage({ roster, actions, start }: {
    roster: ScheduleRoster;
    actions: ScheduleActions;
    start?: string | undefined;
}) {
    const view = useSchedules(actions);
    const [adding, setAdding] = useState(Boolean(start));
    if (view === null)
        return <div className='bt-set-hint'>{t('Loading…')}</div>;
    if (!view.available)
        return <AutomationOff actions={actions} />;
    const shown: ScheduleListener = (next) => { publish(next); setAdding(false); };
    const byChat: [
        string,
        ReactNode,
        string,
        readonly Task[]
    ][] = [
        ...roster.bots.map((bot): [
            string,
            ReactNode,
            string,
            readonly Task[]
        ] => [bot.id, <BotAvatar bot={bot} size={18} badge={false} live={false} />, bot.name, view.tasks.filter(task => task.botId === bot.id)]),
        ...roster.rooms.map((room): [
            string,
            ReactNode,
            string,
            readonly Task[]
        ] => [room.id, <RoomAvatar room={room} roster={roster} size={18} />, room.name, view.tasks.filter(task => task.botId === undefined && task.roomId === room.id)]),
    ].filter(entry => entry[3].length > 0);
    return [
        adding
            ? <TaskForm key='form' roster={roster} actions={actions} start={start} onDone={shown} onCancel={() => setAdding(false)} />
            : <div key='add' className='bt-actions'><button type='button' className='bt-soft bt-soft-sm bt-with-icon' onClick={() => setAdding(true)}><PlusIcon />{t('New task')}</button></div>,
        byChat.length === 0 && !adding
            ? <div key='none' className='bt-set-card'><EmptyState icon={<ClockIcon />} title={t('No scheduled tasks yet.')} hint={t('A scheduled task sends a prompt to a Bot or group on its own.')} action={{ icon: <PlusIcon />, label: t('New task'), onClick: () => setAdding(true) }} /></div> : byChat.map(([id, avatar, name, tasks]) => <section key={id} className='bt-set-section'><h3 className='bt-task-head'>{avatar}{name}</h3><div className='bt-set-card'>{tasks.map(task => <TaskRow key={task.id} task={task} actions={actions} roster={roster} onView={publish} />)}</div></section>),
    ];
}
// A Bot's tasks in its settings form, with the way to add one.
export function BotSchedules({ bot, roster, actions }: {
    bot: {
        readonly id: string;
        readonly name: string;
    };
    roster: ScheduleRoster;
    actions: ScheduleActions;
}) {
    const view = useSchedules(actions);
    if (view === null)
        return null;
    const tasks = view.available ? view.tasks.filter(task => task.botId === bot.id) : [];
    return <section className='bt-set-section'><h3>{t('Scheduled tasks')}</h3><div className='bt-set-card'>{!view.available
        ? <div className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-set-hint'>{t('Scheduled tasks are turned off for this Bot.')}</span></span>{actions.openShellSettingsPanel ? <button type='button' className='bt-soft bt-soft-sm' onClick={actions.openShellSettingsPanel}>{t('Open settings')}</button> : null}</div> : [
        ...tasks.map(task => <TaskRow key={task.id} task={task} actions={actions} roster={roster} onView={publish} />),
        <button key='new' type='button' className='bt-set-row bt-bs-row bt-gs-add' onClick={() => actions.openSettings('schedules', bot.id)}><PlusIcon />{t('New task')}</button>,
    ]}</div></section>;
}
// The details panel's line: the Bot's next tasks, or how to add one.
export function ScheduleSummary({ bot, actions }: {
    bot: {
        readonly id: string;
        readonly name: string;
    };
    actions: ScheduleActions;
}) {
    const view = useSchedules(actions);
    const tasks = view?.available ? view.tasks.filter(task => task.botId === bot.id && task.status === 'active') : [];
    return <div><div className='bt-section-title'>{t('Scheduled tasks')}</div>{tasks.length === 0
        ? <button type='button' className='bt-more' onClick={() => actions.openSettings('schedules', bot.id)}>{view?.available === false ? t('Scheduled tasks are turned off for this Bot.') : t('No scheduled tasks yet. Add one')}</button> : <div className='bt-task-list'>{tasks.slice(0, 3).map(task => <button key={task.id} type='button' className='bt-task-line' onClick={() => actions.openSettings('schedules')}><ClockIcon /><span className='bt-task-line-title'>{task.title}</span><span className='bt-task-line-when'>{timingText(task)}</span></button>)}</div>}</div>;
}
export const SCHEDULE_CSS = `
.bt-task{gap:10px}
.bt-task[data-done]{opacity:.6}
.bt-task[data-busy]{opacity:.4}
.bt-task-title{font-size:13px;line-height:18px;font-weight:500;overflow-wrap:anywhere}
.bt-task-prompt{font-size:12px;line-height:16px;color:var(--bt-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-task-next{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-task-remove{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;color:var(--bt-ink-3)}
.bt-task-remove svg{width:14px;height:14px}
.bt-task-remove[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--bt-danger)}
.bt-task-head{display:flex;align-items:center;gap:6px}
.bt-task-form{animation:bt-q-in .4s cubic-bezier(.22,1,.36,1),bt-veil-in .2s ease-out}
.bt-task-bot{width:auto;min-width:160px;max-width:58%}
.bt-task-when{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.bt-task-when .bt-input{width:auto;height:32px}
.bt-task-time{min-width:110px}
.bt-task-count{width:72px!important}
.bt-task-unit{width:auto;height:32px}
.bt-task-every{font-size:13px;color:var(--bt-ink-2)}
.bt-task-days{display:flex;gap:4px}
.bt-task-day{width:30px;height:30px;border-radius:50%;border:1px solid var(--bt-line);background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease}
.bt-task-day[aria-pressed=true]{background:var(--bt-user);border-color:var(--bt-user);color:var(--bt-user-ink)}
.bt-task-foot{justify-content:flex-end;gap:8px}
.bt-task-foot .bt-send{height:28px;font-size:12px}
.bt-task-off{align-items:center;gap:8px;padding:28px 20px;text-align:center}
.bt-task-off>*+*{border-top:0}
.bt-task-off-mark{width:44px;height:44px;border-radius:50%;background:var(--bt-hover);display:flex;align-items:center;justify-content:center;color:var(--bt-ink-2)}
.bt-task-off-mark svg{width:20px;height:20px}
.bt-task-off-title{font-size:14px;line-height:20px;font-weight:600}
.bt-task-off .bt-set-hint{max-width:380px}
.bt-task-list{display:flex;flex-direction:column;gap:2px}
.bt-task-line{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:6px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;text-align:left;cursor:pointer;transition:background-color .12s ease}
.bt-task-line:hover{background:var(--bt-hover)}
.bt-task-line svg{flex:none;color:var(--bt-ink-3)}
.bt-task-line-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-task-line-when{flex:none;font-size:12px;color:var(--bt-ink-3)}
@media (prefers-reduced-motion:reduce){.bt-task-form{animation:none}}
`;
