import { Fragment, createElement as h, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import { MarkdownText } from './dsh-primitives.tsx';
import { CheckIcon, CloseIcon } from './icons.tsx';
import { t } from './i18n.ts';
import { keyLetter, useOptionKeys } from './questions.tsx';
import { useDockHold } from './card-hold.ts';
import type { DockHoldActions } from './card-hold.ts';
import { heldCardKey } from './sources.ts';
import { checkShownView, normalizeView } from '../shared/views.ts';
interface WidgetOption {
    label: string;
    description?: string | undefined;
}
interface WidgetField {
    id: string;
    label: string;
    placeholder?: string | undefined;
}
interface WidgetColumn {
    key?: string | undefined;
    label?: string | undefined;
}
interface WidgetNode {
    type?: string | undefined;
    id: string;
    children?: readonly WidgetNode[] | undefined;
    options?: readonly (string | WidgetOption)[] | undefined;
    fields?: readonly WidgetField[] | undefined;
    columns?: readonly WidgetColumn[] | undefined;
    rows?: readonly unknown[] | undefined;
    label?: string | undefined;
    value?: string | number | undefined;
    text?: string | undefined;
    tone?: string | undefined;
    percent?: number | undefined;
    multi?: boolean | undefined;
    cancelLabel?: string | undefined;
    confirmLabel?: string | undefined;
    submitLabel?: string | undefined;
    placeholder?: string | undefined;
    description?: string | undefined;
}
interface AnswerValues {
    selected?: readonly string[] | undefined;
    confirmed?: boolean | undefined;
    fields?: Record<string, string> | undefined;
}
export interface AnswerValue {
    action?: string | undefined;
    id?: string | undefined;
    values?: AnswerValues | undefined;
}
type SubmitHandler = (action: string | undefined, values: AnswerValues) => void;
interface WidgetContext {
    onSubmit?: SubmitHandler | undefined;
    settled: boolean;
    answer: AnswerValue | null;
    keys: boolean;
}
interface ShownLike {
    id: string;
    title?: string | undefined;
    callId?: string | undefined;
    view: WidgetNode;
}
type WidgetCallArgs = {
    text?: ((name: string) => string) | undefined;
    value?: ((name: string) => unknown) | undefined;
};
type RosterHook = <T>(select: (value: {
    views?: Record<string, ShownLike | undefined> | undefined;
}) => T) => T;
type CardsHook = <T>(select: (value: Record<string, Record<string, number> | undefined>) => T) => T;
export interface WidgetActions extends DockHoldActions {
    answerView: (sessionId: string, viewId: string, action: string | undefined, values: AnswerValues) => Promise<unknown>;
    dismissView: (sessionId: string) => Promise<unknown>;
}
const mdLabels = () => ({ code: { copyLabel: t('Copy'), copiedLabel: t('Copied') }, footnotes: t('Footnotes') });
const optionsOf = (node: WidgetNode): WidgetOption[] => (Array.isArray(node.options) ? node.options : [])
    .map(option => (typeof option === 'string' ? { label: option } : option))
    .filter(option => option !== null && typeof option === 'object' && option.label !== undefined);
const fieldsOf = (node: WidgetNode): WidgetField[] => (Array.isArray(node.fields) ? node.fields : [])
    .filter(field => field !== null && typeof field === 'object' && field.id !== undefined);
const cellText = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
const countType = (node: WidgetNode, type: string): number => {
    if (node === null || typeof node !== 'object')
        return 0;
    const children = Array.isArray(node.children) ? node.children : [];
    return (node.type === type ? 1 : 0) + children.reduce((sum, child) => sum + countType(child, type), 0);
};
// The values an answer carries belong to the component whose id is its action.
const answerValues = (answer: AnswerValue | null, node: WidgetNode): AnswerValues | undefined => (answer?.action === node.id ? answer.values : undefined);
function OptionsInput({ node, onSubmit, keys }: {
    node: WidgetNode;
    onSubmit?: SubmitHandler | undefined;
    keys: boolean;
}) {
    const [picked, setPicked] = useState<string[]>([]);
    const options = optionsOf(node);
    const multi = node.multi === true;
    const choose = (label: string): void => {
        if (multi) {
            setPicked(current => (current.includes(label) ? current.filter(item => item !== label) : [...current, label]));
            return;
        }
        onSubmit?.(node.id, { selected: [label] });
    };
    const submit = (): void => { if (picked.length > 0)
        onSubmit?.(node.id, { selected: picked }); };
    const ownRef = useRef<HTMLButtonElement | null>(null);
    useOptionKeys(keys ? options.length : 0, (index: number) => choose(options[index]?.label ?? ''), ownRef);
    return <><div className='bt-q-list' role='group'>{options.map((option, index) => {
        const selected = multi && picked.includes(option.label);
        return <button key={option.label} type='button' className='bt-q-opt' aria-pressed={multi ? selected : undefined} aria-keyshortcuts={keys ? keyLetter(index).toLowerCase() : undefined} onClick={() => choose(option.label)}>{keys ? <span className='bt-key' aria-hidden>{keyLetter(index)}</span> : null}<span className='bt-q-body'><span className='bt-q-label'>{option.label}</span>{option.description ? <span className='bt-q-desc'>{option.description}</span> : null}</span>{selected ? <span className='bt-q-check' title={t('Selected')}>{h(CheckIcon)}</span> : null}</button>;
    })}</div>{multi ? <div className='bt-q-foot'><button type='button' className='bt-q-submit' disabled={picked.length === 0} onClick={submit}>{t('Submit')}</button></div> : null}</>;
}
function SettledOptions({ node, answer }: {
    node: WidgetNode;
    answer: AnswerValue | null;
}) {
    const selected = answerValues(answer, node)?.selected;
    const chosen = Array.isArray(selected) ? selected : [];
    return <div className='bt-q-list' role='group' aria-label={t('Your answer')}>{optionsOf(node).map(option => <div key={option.label} className='bt-q-opt'><span className='bt-q-body'><span className='bt-q-label'>{option.label}</span>{option.description ? <span className='bt-q-desc'>{option.description}</span> : null}</span>{chosen.includes(option.label) ? <span className='bt-q-check' title={t('Selected')}>{h(CheckIcon)}</span> : null}</div>)}</div>;
}
function ConfirmInput({ node, onSubmit }: {
    node: WidgetNode;
    onSubmit?: SubmitHandler | undefined;
}) {
    return <div className='bt-q-foot'><button type='button' className='bt-q-btn' onClick={() => onSubmit?.(node.id, { confirmed: false })}>{node.cancelLabel ?? t('Cancel')}</button><button type='button' className='bt-q-submit' onClick={() => onSubmit?.(node.id, { confirmed: true })}>{node.confirmLabel ?? t('Confirm')}</button></div>;
}
function SettledConfirm({ node, answer }: {
    node: WidgetNode;
    answer: AnswerValue | null;
}) {
    const confirmed = answerValues(answer, node)?.confirmed;
    if (confirmed !== true && confirmed !== false) {
        return <div className='bt-q-foot'><button type='button' className='bt-q-btn' disabled>{node.cancelLabel ?? t('Cancel')}</button><button type='button' className='bt-q-submit' disabled>{node.confirmLabel ?? t('Confirm')}</button></div>;
    }
    const label = confirmed ? (node.confirmLabel ?? t('Confirm')) : (node.cancelLabel ?? t('Cancel'));
    return <span className='bt-q-badge'>{label}</span>;
}
function FormInput({ node, onSubmit }: {
    node: WidgetNode;
    onSubmit?: SubmitHandler | undefined;
}) {
    const fields = fieldsOf(node);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const submit = (): void => onSubmit?.(node.id, { fields: Object.fromEntries(fields.map(field => [field.id, draft[field.id] ?? ''])) });
    return <form className='bt-widget-form' onSubmit={(event) => { event.preventDefault(); submit(); }}>{fields.map(field => <label key={field.id} className='bt-widget-field'><span className='bt-widget-field-label'>{field.label}</span><span className='bt-q-field'><input className='bt-q-input' type='text' value={draft[field.id] ?? ''} autoComplete='off' spellCheck={false} aria-label={field.label} placeholder={field.placeholder ?? undefined} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(current => ({ ...current, [field.id]: event.target.value }))} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing)
            return;
        event.preventDefault();
        submit();
    }}/></span></label>)}<div className='bt-q-foot'><button type='submit' className='bt-q-submit'>{node.submitLabel ?? t('Submit')}</button></div></form>;
}
function SettledForm({ node, answer }: {
    node: WidgetNode;
    answer: AnswerValue | null;
}) {
    const fields = answerValues(answer, node)?.fields;
    const values = fields ?? {};
    return <div className='bt-widget-form'>{fieldsOf(node).map(field => <label key={field.id} className='bt-widget-field'><span className='bt-widget-field-label'>{field.label}</span><span className='bt-q-field'><input className='bt-q-input' type='text' value={values[field.id] ?? ''} disabled readOnly aria-label={field.label}/></span></label>)}</div>;
}
function WidgetTable({ node }: {
    node: WidgetNode;
}) {
    const columns: WidgetColumn[] = (Array.isArray(node.columns) ? node.columns : []).filter(column => column !== null && typeof column === 'object');
    const rows: readonly unknown[] = Array.isArray(node.rows) ? node.rows : [];
    return <div className='bt-widget-table'><table><thead><tr>{columns.map((column, index) => <th key={column.key ?? index} scope='col'>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column, columnIndex) => <td key={column.key ?? columnIndex}>{cellText(Array.isArray(row) ? row[columnIndex] : undefined)}</td>)}</tr>)}</tbody></table></div>;
}
function WidgetProgress({ node }: {
    node: WidgetNode;
}) {
    const percent = Math.max(0, Math.min(100, Number(node.percent) || 0));
    return <div className='bt-widget-progress'><span className='bt-widget-progress-label'><span>{node.label}</span><span>{`${Math.round(percent)}%`}</span></span><div className='bt-widget-progress-track' role='progressbar' aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={node.label ?? t('Progress')}><div className='bt-widget-progress-fill' style={{ width: `${percent}%` }}/></div></div>;
}
// One blueprint node. Unknown types render nothing: the host validates the
// blueprint, so what arrives here is known or safely ignored.
function WidgetNode({ node, ctx }: {
    node: WidgetNode;
    ctx: WidgetContext;
}): ReactElement | null {
    if (node === null || typeof node !== 'object')
        return null;
    switch (node.type) {
        case 'stack': {
            const children: readonly WidgetNode[] = Array.isArray(node.children) ? node.children : [];
            return <div className='bt-widget-stack'>{children.map((child, index) => h(WidgetNode, { key: child.id ?? index, node: child, ctx }))}</div>;
        }
        case 'text':
            return h(MarkdownText, { text: String(node.text ?? ''), labels: mdLabels(), variant: 'compact' });
        case 'metric': {
            const tone = node.tone !== undefined && ['good', 'warn', 'bad'].includes(node.tone) ? node.tone : undefined;
            return <div className='bt-widget-metric' data-tone={tone}><span className='bt-widget-metric-label'>{node.label}</span><span className='bt-widget-metric-value'>{node.value}</span></div>;
        }
        case 'table': return h(WidgetTable, { node });
        case 'options': return ctx.settled ? h(SettledOptions, { node, answer: ctx.answer }) : h(OptionsInput, { node, onSubmit: ctx.onSubmit, keys: ctx.keys });
        case 'confirm': return ctx.settled ? h(SettledConfirm, { node, answer: ctx.answer }) : h(ConfirmInput, { node, onSubmit: ctx.onSubmit });
        case 'form': return ctx.settled ? h(SettledForm, { node, answer: ctx.answer }) : h(FormInput, { node, onSubmit: ctx.onSubmit });
        case 'progress': return h(WidgetProgress, { node });
        default: return null;
    }
}
// A whole blueprint. Letter keys answer a lone options block from the keyboard;
// with more than one in a card the same letter would hit both.
export function WidgetView({ view, onSubmit, settled = false, answer = null }: {
    view: WidgetNode;
    onSubmit?: SubmitHandler | undefined;
    settled?: boolean | undefined;
    answer?: AnswerValue | null;
}) {
    const ctx = { onSubmit, settled, answer, keys: !settled && countType(view, 'options') === 1 };
    return h(WidgetNode, { node: view, ctx });
}
// The card chrome every view wears, pending or settled: a title bar with a small
// "View" tag, and a dismiss button while the card still waits for an answer.
export function WidgetCard({ title, view, onSubmit, onDismiss, raised = false, settled = false, answer = null }: {
    title: string;
    view: WidgetNode;
    onSubmit?: SubmitHandler | undefined;
    onDismiss?: (() => void) | undefined;
    raised?: boolean | undefined;
    settled?: boolean | undefined;
    answer?: AnswerValue | null;
}) {
    const titleId = useId();
    return <div className={settled ? 'bt-q bt-q-settled' : raised ? 'bt-q bt-q-raised' : 'bt-q'} role='group' aria-labelledby={titleId}><div className='bt-q-head'><div className='bt-q-text'><p className='bt-q-title' id={titleId}>{title}</p></div><span className='bt-q-badge'>{t('View')}</span>{onDismiss ? <button type='button' className='bt-q-x' aria-label={t('Dismiss view')} title={t('Dismiss')} onClick={onDismiss}>{h(CloseIcon)}</button> : null}</div>{h(WidgetView, { view, onSubmit, settled, answer })}</div>;
}
// A view waiting for its answer, inline at its call or raised in the dock. Like a
// pending question it hides on submit and comes back if the reply fails.
export function PendingView({ sessionId, view, actions, inline }: {
    sessionId: string;
    view: ShownLike;
    actions: WidgetActions;
    inline: boolean;
}) {
    const [answered, setAnswered] = useState<string | null>(null);
    const hold = useDockHold(sessionId, 'view', view.id, actions, inline);
    const onSubmit = (action: string | undefined, values: AnswerValues): void => {
        setAnswered(view.id);
        void actions.answerView(sessionId, view.id, action, values).catch(() => setAnswered(null));
    };
    const onDismiss = () => {
        setAnswered(view.id);
        void Promise.resolve(actions.dismissView(sessionId)).catch(() => setAnswered(null));
    };
    // Hidden, not unmounted, while the answer is on its way: if it fails the card comes
    // back with what the user had typed or picked.
    return <div className={inline ? 'bt-q-inline' : 'bt-q-dock'} style={answered === view.id ? { display: 'none' } : undefined} onFocusCapture={hold} onPointerDownCapture={hold}>{h(WidgetCard, { key: view.id, title: view.title ?? '', view: view.view, onSubmit, onDismiss, raised: !inline })}</div>;
}
// The show_view call in the transcript.
export function WidgetCell({ sessionId, callId, args, done, isError, roster, actions, heldCards }: {
    sessionId: string;
    callId: string;
    args?: WidgetCallArgs | undefined;
    done: boolean;
    isError: boolean;
    roster: {
        views?: Record<string, ShownLike | undefined> | undefined;
    };
    actions: WidgetActions;
    heldCards?: Record<string, number> | undefined;
}) {
    const record = roster.views?.[sessionId];
    if (record !== undefined && record.callId === callId) {
        if ((heldCards?.[heldCardKey('view', record.id)] ?? 0) > 0)
            return null;
        return h(PendingView, { sessionId, view: record, actions, inline: true });
    }
    // A refused call (bad blueprint) drew no card; don't render an empty one.
    if (done && isError)
        return <span className='bt-q-gone' hidden/>;
    // Display-only cards draw from the recorded call arguments, which keep the
    // provider's encoding: unwrap it the same way the host does before storing. The
    // args accessor reads strings through `text`; `value` drops them.
    const blueprint = normalizeView(args?.value?.('view')) as WidgetNode;
    const shown = checkShownView(args?.text?.('title'), blueprint);
    // A call the host refused — a blueprint it would not show, or a reply it cannot
    // wait for — leaves no card; the model's retry then stays the only one. So does
    // a settled interactive call: answered, dismissed or replaced, it leaves no gap
    // where it was (same as ask_user).
    if (shown.error !== undefined || shown.interactive || args?.value?.('await_reply') === true) {
        return <span className='bt-q-gone' hidden/>;
    }
    return <div className='bt-q-inline'>{h(WidgetCard, { title: shown.title, view: blueprint })}</div>;
}
// Views asked by a call the transcript does not draw wait above the composer,
// mirroring the question dock.
export function WidgetDock({ sessionId, useRoster, useCards, useHeldCards, actions }: {
    sessionId: string;
    useRoster: RosterHook;
    useCards?: CardsHook | undefined;
    useHeldCards?: CardsHook | undefined;
    actions: WidgetActions;
}) {
    const view = useRoster(value => value.views?.[sessionId]);
    const drawn = useCards?.(state => view?.callId !== undefined && (state[sessionId]?.[view.callId] ?? 0) > 0) === true;
    const held = useHeldCards?.(state => view !== undefined && (state[sessionId]?.[heldCardKey('view', view.id)] ?? 0) > 0) === true;
    if (view === undefined || (view.callId && drawn && !held))
        return null;
    return h(PendingView, { sessionId, view, actions, inline: false });
}
export { WIDGET_CSS } from './widget-cell-css.ts';

export { AnsweredView, AnsweredReply } from './widget-answered.tsx';
