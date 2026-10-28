// The memory dialog of a Bot or a group chat (`owner`: { id, name, group }): a summary
// a model writes from every saved entry, the entries themselves behind the ⋯ menu,
// and "Ask or update", one model call that answers from the entries or changes them.
// Modeled on ChatGPT's memory summary.
import { Fragment, createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useEscape, useMenuKeys } from './overlay-hooks.ts';
import { EmptyState } from './empty-state.tsx';
import { ArrowUpIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DotsIcon, MemoryIcon, TrashIcon } from './icons.tsx';
import { dateLocale, hostText, t } from './i18n.ts';
import { summaryBlocks } from './text.ts';
import { MENU_EXIT_MS, useLinger } from './motion.tsx';
import { ago, Skeleton, useNow } from './memory-time.tsx';
const POLL_MS = 1500;
export interface MemoryOwner {
    id: string;
    name: string;
    group?: boolean | undefined;
}
export interface MemoryEntry {
    scope: string;
    topic?: string | undefined;
    text: string;
    added?: string | undefined;
    by?: string | undefined;
    source?: string | undefined;
}
interface MemorySummary {
    at: number;
    text: string;
}
export interface MemoryView {
    entries: MemoryEntry[];
    sizes: {
        own: number;
        team: number;
        group: number;
    };
    limits: {
        main: number;
    };
    summary?: MemorySummary | null;
    fresh?: boolean | undefined;
    summarizing?: boolean | undefined;
    error?: unknown;
}
export interface MemoryChange {
    ok: boolean;
    op?: string | undefined;
    scope?: string | undefined;
    text: string;
    error?: unknown;
}
interface MemoryAnswer {
    asked: string;
    pending?: boolean | undefined;
    reply?: string | undefined;
    error?: unknown;
    changes?: MemoryChange[] | undefined;
}
interface MemoryFlags {
    summarize?: boolean | undefined;
    regenerate?: boolean | undefined;
}
interface MemoryAskResult {
    reply?: string | undefined;
    changes: MemoryChange[];
    view: MemoryView;
}
export interface MemoryActions {
    openMemory: (id: string) => void;
    closeMemory: () => void;
    memoryView: (id: string, flags?: MemoryFlags) => Promise<MemoryView>;
    memoryAsk: (id: string, text: string) => Promise<MemoryAskResult>;
    memoryForget: (id: string, entry: MemoryEntry) => Promise<MemoryView>;
}
// Entry counts per Bot or group, for the details pane; the dialog updates them as it loads.
const counts = new Map<string, number>();
const countListeners = new Set<() => void>();
function noteCount(id: string, count: number): void {
    if (counts.get(id) === count)
        return;
    counts.set(id, count);
    for (const listener of countListeners)
        listener();
}
export function useMemoryCount(id: string, actions: Pick<MemoryActions, 'memoryView'>): number | null {
    const [count, setCount] = useState(counts.get(id) ?? null);
    useEffect(() => {
        const listener = () => setCount(counts.get(id) ?? null);
        countListeners.add(listener);
        listener();
        let stop = false;
        actions.memoryView?.(id).then((view) => { if (!stop)
            noteCount(id, view.entries.length); }).catch(() => { });
        return () => { stop = true; countListeners.delete(listener); };
    }, [id]);
    return count;
}
export interface MemoryRowProps {
    owner: MemoryOwner;
    actions: MemoryActions;
}
// The details pane's row: how much the Bot or group keeps, and the way into the dialog.
export function MemoryRow({ owner, actions }: MemoryRowProps) {
    const count = useMemoryCount(owner.id, actions);
    const label = count === null ? t('Loading…') : count === 0 ? t('Nothing saved yet') : count === 1 ? t('1 entry') : t('{count} entries', { count });
    return <div><div className='bt-section-title'>{t('Memory')}</div><button type='button' className='bt-mem-row' aria-label={t("Manage {name}'s memory", { name: owner.name })} onClick={() => actions.openMemory(owner.id)}><MemoryIcon /><span className='bt-mem-row-copy'>{label}</span><span className='bt-mem-row-go'>{t('Manage')}<ChevronRightIcon /></span></button></div>;
}
interface SummaryProps {
    owner: MemoryOwner;
    view: MemoryView;
    regenerate: () => void;
}
function Summary({ owner, view, regenerate }: SummaryProps) {
    if (view.entries.length === 0) {
        return <EmptyState icon={<MemoryIcon />} title={owner.group ? t('Nothing is saved for this group yet') : t('{name} has not saved anything yet', { name: owner.name })} hint={owner.group
                ? t('A group keeps the decisions, rules, and facts its work needs, for its members to read here. Tell it below, or in the group.')
                : t('Bots keep lasting preferences, decisions, and what you ask them to remember. Tell {name} below, or in its chat.', { name: owner.name })} />;
    }
    const failed = view.error && !view.summarizing
        ? <div className='bt-mem-failed' role='alert'><span>{view.summary ? t('The summary is out of date: {reason}', { reason: hostText(String(view.error ?? '')) }) : t('The summary could not be written: {reason}', { reason: hostText(String(view.error ?? '')) })}</span><button type='button' className='bt-soft bt-soft-sm' onClick={regenerate}>{t('Try again')}</button></div> : null;
    if (!view.summary)
        return <>{failed}{failed ? null : <Skeleton label={t('Writing the summary…')} />}</>;
    return <>{failed}<div key={view.summary.at} className='bt-mem-summary' data-stale={!view.fresh || undefined}>{summaryBlocks(view.summary.text).map((block, index) => (block.kind === 'h'
        ? <h3 key={index}>{block.text}</h3> : <p key={index}>{block.text}</p>))}</div></>;
}
interface EntryGroup {
    key: string;
    scope: string;
    topic?: string | undefined;
    entries: MemoryEntry[];
}
const groupEntries = (entries: readonly MemoryEntry[]): EntryGroup[] => entries.reduce<EntryGroup[]>((groups, entry) => {
    const key = `${entry.scope}:${entry.topic ?? ''}`;
    const group = groups.find(item => item.key === key);
    if (group)
        group.entries.push(entry);
    else
        groups.push({ key, scope: entry.scope, topic: entry.topic, entries: [entry] });
    return groups;
}, []);
interface EntryRowProps {
    entry: MemoryEntry;
    remove: (entry: MemoryEntry) => Promise<boolean>;
}
function EntryRow({ entry, remove }: EntryRowProps) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!confirming)
            return undefined;
        const timer = setTimeout(() => setConfirming(false), 3000);
        return () => clearTimeout(timer);
    }, [confirming]);
    const by = entry.source === 'memory panel' ? t('by you') : entry.by ? t('by {name}', { name: entry.by }) : null;
    const meta = [entry.added, by].filter(Boolean).join(' · ');
    const click = async (): Promise<void> => {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setBusy(true);
        if (!await remove(entry))
            setBusy(false);
    };
    return <li className='bt-mem-entry' data-busy={busy || undefined}><div className='bt-mem-entry-copy'><span className='bt-mem-entry-text'>{entry.text}</span>{meta ? <span className='bt-mem-entry-meta'>{meta}</span> : null}</div><button type='button' className='bt-mem-remove' data-confirm={confirming || undefined} disabled={busy} aria-label={confirming ? t('Click again to remove') : t('Remove from memory')} title={confirming ? undefined : t('Remove from memory')} onClick={click}>{confirming ? t('Remove') : <TrashIcon />}</button></li>;
}
interface EntriesProps {
    owner: MemoryOwner;
    view: MemoryView;
    remove: (entry: MemoryEntry) => Promise<boolean>;
}
function Entries({ owner, view, remove }: EntriesProps) {
    const groups = groupEntries(view.entries);
    const sections = owner.group
        ? [{ scope: 'group', title: t('Group memory'), hint: t('Only its members read it'), size: view.sizes.group }]
        : [
            { scope: 'own', title: t("{name}'s memory", { name: owner.name }), size: view.sizes.own },
            { scope: 'team', title: t('Team memory'), hint: t('Every Bot reads it'), size: view.sizes.team },
        ];
    return <div className='bt-mem-entries'>{sections.map(section => <section key={section.scope} className='bt-mem-section'><div className='bt-mem-section-head'><h3>{section.title}</h3>{section.hint ? <span>{section.hint}</span> : null}<span className='bt-mem-size' title={t('MEMORY.md, which every conversation reads')}>{t('{used} of {limit} characters', { used: section.size.toLocaleString(dateLocale()), limit: view.limits.main.toLocaleString(dateLocale()) })}</span></div>{groups.some(group => group.scope === section.scope)
        ? groups.filter(group => group.scope === section.scope).map(group => <>{group.topic ? <div className='bt-mem-topic'>{group.topic}</div> : null}<ul className='bt-mem-list'>{group.entries.map(entry => <EntryRow key={`${entry.topic ?? ''}:${entry.text}`} entry={entry} remove={remove} />)}</ul></>)
        : <div className='bt-mem-none'>{t('Nothing saved yet')}</div>}</section>)}</div>;
}
function changeLine(change: MemoryChange): string {
    const text = change.text.length > 120 ? `${change.text.slice(0, 120)}…` : change.text;
    if (!change.ok)
        return t('Not changed: {text} ({reason})', { text, reason: hostText(String(change.error ?? '')) });
    if (change.op === 'remove')
        return change.scope === 'team' ? t('Removed from team memory: {text}', { text }) : t('Removed: {text}', { text });
    if (change.op === 'edit')
        return t('Updated: {text}', { text });
    return change.scope === 'team' ? t('Added to team memory: {text}', { text }) : t('Added: {text}', { text });
}
function Reply({ answer, dismiss }: {
    answer: MemoryAnswer;
    dismiss: () => void;
}) {
    return <div className='bt-mem-reply' role='status'><div className='bt-mem-reply-head'><span className='bt-mem-reply-asked'>{answer.asked}</span>{answer.pending ? null : <button type='button' className='bt-icon-btn' aria-label={t('Dismiss')} onClick={dismiss}><CloseIcon /></button>}</div>{answer.pending ? <div className='bt-mem-reply-text bt-shimmer'>{t('Thinking…')}</div> : answer.error ? <div className='bt-mem-reply-text bt-danger'>{hostText(String(answer.error ?? ''))}</div> : <>{answer.reply ? <div className='bt-mem-reply-text'>{answer.reply}</div> : null}{(answer.changes?.length ?? 0) > 0
        ? <ul className='bt-mem-changes'>{(answer.changes ?? []).map((change, index) => <li key={index} data-ok={change.ok || undefined}>{change.ok ? <CheckIcon /> : <CloseIcon />}<span>{changeLine(change)}</span></li>)}</ul> : null}</>}</div>;
}
interface MemoryViewState {
    view: MemoryView | null;
    error: string;
    load: (flags?: MemoryFlags) => Promise<void>;
    show: (next: MemoryView) => void;
}
// The view as the host has it, loaded again while a summary is being written. Only the
// latest request's answer counts.
function useMemoryView(id: string, actions: Pick<MemoryActions, 'memoryView'>): MemoryViewState {
    const [view, setView] = useState<MemoryView | null>(null);
    const [error, setError] = useState('');
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef(0);
    const alive = useRef(true);
    const show = useCallback((next: MemoryView) => {
        setView(next);
        setError('');
        noteCount(id, next.entries.length);
    }, [id]);
    const load = useCallback(async (flags: MemoryFlags = {}) => {
        clearTimeout(timer.current);
        const ticket = ++latest.current;
        try {
            const next = await actions.memoryView(id, flags);
            if (!alive.current || ticket !== latest.current)
                return;
            show(next);
            if (next.summarizing)
                timer.current = setTimeout(() => void load({ summarize: flags.summarize || flags.regenerate }), POLL_MS);
        }
        catch (failure) {
            if (alive.current && ticket === latest.current)
                setError((failure as {
                    message?: string;
                } | null)?.message ?? String(failure));
        }
    }, [id]);
    useEffect(() => {
        alive.current = true;
        void load({ summarize: true });
        return () => { alive.current = false; clearTimeout(timer.current); };
    }, [id]);
    return { view, error, load, show };
}
export interface MemoryDialogProps {
    owner: MemoryOwner;
    actions: MemoryActions;
    leaving?: boolean | undefined;
}
export function MemoryDialog({ owner, actions, leaving = false }: MemoryDialogProps) {
    const { view, error, load, show } = useMemoryView(owner.id, actions);
    const [page, setPage] = useState('summary');
    const [menu, setMenu] = useState(false);
    const [menuShown, menuLeaving] = useLinger(menu, MENU_EXIT_MS);
    const [text, setText] = useState('');
    const [answer, setAnswer] = useState<MemoryAnswer | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const dotsRef = useRef<HTMLButtonElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const now = useNow(30000);
    const close = useCallback(() => actions.closeMemory(), []);
    useEscape(close);
    useEscape(() => { setPage('summary'); void load({ summarize: true }); }, page === 'entries');
    useEscape(() => { setMenu(false); dotsRef.current?.focus(); }, menu);
    useMenuKeys(menuRef, menu);
    useEffect(() => {
        if (!menu)
            return undefined;
        const onDown = (event: MouseEvent) => {
            if (menuRef.current?.contains(event.target as Node) || dotsRef.current?.contains(event.target as Node))
                return;
            setMenu(false);
        };
        window.addEventListener('mousedown', onDown);
        return () => {
            window.removeEventListener('mousedown', onDown);
        };
    }, [menu]);
    const regenerate = () => { setMenu(false); setPage('summary'); void load({ regenerate: true }); };
    const openEntries = () => { setMenu(false); setPage('entries'); };
    const backToSummary = () => { setPage('summary'); void load({ summarize: true }); };
    const remove = async (entry: MemoryEntry): Promise<boolean> => {
        try {
            show(await actions.memoryForget(owner.id, entry));
            return true;
        }
        catch (failure) {
            setAnswer({ asked: entry.text, error: (failure as {
                    message?: string;
                } | null)?.message ?? String(failure) });
            return false;
        }
    };
    const ask = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const asked = text.trim();
        if (asked === '' || answer?.pending)
            return;
        setText('');
        setAnswer({ asked, pending: true });
        try {
            const result = await actions.memoryAsk(owner.id, asked);
            setAnswer({ asked, reply: result.reply, changes: result.changes });
            show(result.view);
            if (result.changes.some(change => change.ok))
                void load({ summarize: page === 'summary' });
        }
        catch (failure) {
            setAnswer({ asked, error: (failure as {
                    message?: string;
                } | null)?.message ?? String(failure) });
        }
        inputRef.current?.focus();
    };
    const count = view?.entries.length ?? 0;
    const when = view?.summary ? ago(view.summary.at, now) : null;
    const status = view === null ? ''
        : page === 'entries' ? (count === 1 ? t('1 entry') : t('{count} entries', { count }))
            : view.summarizing && view.summary ? t('Updating…')
                : view.summary && view.fresh ? (when ? t('Updated {time}', { time: when }) : t('Updated just now'))
                    : '';
    const busy = answer?.pending === true;
    return <div className='bt-mem-layer' data-leaving={leaving || undefined}><div className='bt-scrim bt-mem-scrim' onMouseDown={close}/><div className='bt-mem' role='dialog' aria-modal aria-label={t("{name}'s memory", { name: owner.name })}><div className='bt-mem-head'>{page === 'entries' ? <button type='button' className='bt-icon-btn' aria-label={t('Back to the summary')} onClick={backToSummary}><ChevronLeftIcon /></button> : null}<h2>{page === 'entries' ? t('All entries') : t('Memory summary')}</h2><span className='bt-mem-status'>{page === 'summary' ? [owner.name, status].filter(Boolean).join(' · ') : status}</span><span className='bt-mem-head-gap'/><button ref={dotsRef} type='button' className='bt-icon-btn' aria-label={t('Memory options')} aria-haspopup='menu' aria-expanded={menu} onClick={() => setMenu(value => !value)}><DotsIcon /></button><button type='button' className='bt-icon-btn' aria-label={t('Close memory')} onClick={close}><CloseIcon /></button>{menuShown ? <div ref={menuRef} className='bt-menu bt-mem-menu' role='menu' aria-label={t('Memory options')} data-leaving={menuLeaving || undefined}><button type='button' role='menuitem' onClick={openEntries}><span className='bt-menu-label'>{t('All entries')}</span><span className='bt-menu-hint'>{String(count)}</span></button><button type='button' role='menuitem' disabled={count === 0 || view?.summarizing} onClick={regenerate}><span className='bt-menu-label'>{t('Regenerate summary')}</span></button></div> : null}</div><div className='bt-mem-body'>{error ? <div className='bt-error' role='alert' style={{ padding: 0 }}>{hostText(error)}</div> : null}{view === null ? (error ? null : <Skeleton />)
        : page === 'entries' ? <Entries owner={owner} view={view} remove={remove} />
            : <Summary owner={owner} view={view} regenerate={regenerate} />}</div><div className='bt-mem-foot'>{answer ? <Reply answer={answer} dismiss={() => setAnswer(null)} /> : null}<form className='bt-mem-ask' onSubmit={ask}><input ref={inputRef} className='bt-mem-input' value={text} maxLength={2000} disabled={view === null} placeholder={t('Ask or update')} aria-label={t("Ask about or update {name}'s memory", { name: owner.name })} onChange={event => setText(event.target.value)}/><button type='submit' className='bt-mem-send' disabled={busy || text.trim() === ''} aria-label={t('Send')}>{busy ? <span className='bt-mem-spin' aria-hidden/> : <ArrowUpIcon />}</button></form></div></div></div>;
}
