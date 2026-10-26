import type React from 'react';
// Moon Bot patch: a finished turn's thinking and tool steps stay out of the chat. One
// quiet line ("已工作 12s · 5 步") stands where DS Bot drew its thinking row; clicking it
// opens a side panel with the whole process: thinking, tool calls with their
// arguments, and their outputs, in order.
import { createElement as h, Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { contentText, toolName, elapsedLabel } from '../../text.ts';
import { callTree } from '../../cells.ts';
import { t } from '../../i18n.ts';
import { EASE_PANEL, PANEL_LINGER_MS, SPRING_SHAPE } from '../../motion.tsx';
import { useTurnRetries } from '../../retry-cell.tsx';
import { useEscape } from '../../overlay-hooks.ts';
import { AnimatePresence, motion } from 'framer-motion';
import type { RetryEntry } from '../../retry-cell.tsx';
// A step of the turn as the transcript hands it over: thinking blocks, a tool root, or
// the time it began, which is what orders it.
interface WorkBlock {
    kind?: string;
    text?: unknown;
}
interface WorkNode {
    time?: number;
    seq?: number;
    root?: {
        time?: number;
        seq?: number;
    };
    finalNode?: {
        seq?: number;
    };
    blocks?: readonly WorkBlock[];
}
// One call of the turn, as the transcript's call tree states it.
interface ToolCall {
    name?: string;
    kind?: string;
    isError?: boolean;
    argsRaw?: string;
    call?: {
        argsRaw?: string;
    };
    content?: unknown;
    callId?: string;
}
// A thinking step, a tool call, or a retry, as the panel lists them.
type PanelItem = {
    seq: number;
    key: string;
    kind: 'tool';
    call: ToolCall;
} | {
    seq: number;
    key: string;
    kind: 'reasoning' | 'text';
    text: string;
} | {
    seq: number;
    key: string;
    kind: 'retry';
    retry: RetryEntry;
};
// Steps carry no seq; both carry the time they began, which orders them.
const seqOf = (item: WorkNode | undefined): number => item?.time ?? item?.root?.time ?? item?.finalNode?.seq ?? item?.seq ?? item?.root?.seq ?? 0;
// Every call of the turn, sub-calls included, in the order they ran.
export function turnCalls(tools: readonly WorkNode[] | undefined): {
    call: ToolCall;
    seq: number;
}[] {
    const calls: {
        call: ToolCall;
        seq: number;
    }[] = [];
    for (const node of [...(tools ?? [])].sort((a, b) => seqOf(a) - seqOf(b))) {
        const root = node.root;
        if (root)
            calls.push(...(callTree(root as never) as ToolCall[]).map(call => ({ call, seq: seqOf(node) })));
    }
    return calls;
}
export function processCount(steps: readonly WorkNode[] | undefined, tools: readonly WorkNode[] | undefined): number {
    const thoughts = (steps ?? []).filter(step => (step?.blocks ?? []).some(block => block?.kind === 'reasoning' && String(block.text ?? '').trim() !== '')).length;
    return thoughts + turnCalls(tools).length;
}
// One line per step, for the fold under the work line.
function summaryRows(steps: readonly WorkNode[] | undefined, tools: readonly WorkNode[] | undefined, retries: readonly RetryEntry[]): {
    seq: number;
    kind: string;
    text: string;
    failed?: boolean | undefined;
}[] {
    const rows: {
        seq: number;
        kind: string;
        text: string;
        failed?: boolean | undefined;
    }[] = [];
    for (const step of steps ?? []) {
        for (const block of step?.blocks ?? []) {
            const text = String(block?.text ?? '').trim();
            if (block?.kind === 'reasoning' && text)
                rows.push({ seq: seqOf(step), kind: 'reasoning', text: (text.split('\n')[0] ?? '').slice(0, 90) });
        }
    }
    turnCalls(tools).forEach(({ call, seq }, index) => rows.push({ seq: seq + 0.5 + index / 1000, kind: 'tool', text: toolName(call as never) ?? '?', failed: call.kind === 'tool-result' && call.isError }));
    for (const retry of retries)
        rows.push({ seq: retry.seq, kind: 'retry', text: `${t('Retried')} ${retry.retry}/${retry.maximum}` });
    return rows.sort((a, b) => a.seq - b.seq);
}
export function WorkLine({ steps, tools, ms, sessionId, turn }: {
    steps?: readonly WorkNode[] | undefined;
    tools?: readonly WorkNode[] | undefined;
    ms?: number | undefined;
    sessionId: string;
    turn: number | undefined;
}) {
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const retries = useTurnRetries(sessionId, turn);
    const count = processCount(steps, tools) + retries.length;
    if (count === 0)
        return null;
    const label = ms !== undefined && ms >= 1000
        ? t('Worked for {time} · {count} steps', { time: elapsedLabel(ms), count })
        : t('{count} steps', { count });
    const rows = expanded ? summaryRows(steps, tools, retries) : [];
    return <><button type='button' className='bt-work-line' aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span>{label}</span><span aria-hidden className='bt-work-chev'>›</span></button><div className='bt-work-fold' data-open={expanded || undefined} aria-hidden={!expanded}><div className='bt-work-fold-in'><ol className='bt-work-steps'>{rows.map((row, index) => <li key={index} data-kind={row.kind} data-failed={row.failed || undefined}><span className='bt-work-kind'>{row.kind === 'tool' ? t('Tool') : row.kind === 'retry' ? t('Model retry') : t('Thinking')}</span><span className='bt-work-text'>{row.text}</span></li>)}</ol><button type='button' className='bt-work-all' tabIndex={expanded ? 0 : -1} aria-haspopup='dialog' onClick={() => setOpen(true)}>{t('Full process')}</button></div></div><AnimatePresence>{open ? h(ProcessPanel, { key: 'panel', steps, tools, retries, label, onClose: () => setOpen(false) }) : null}</AnimatePresence></>;
}
function pretty(raw: unknown): string {
    if (raw === undefined || raw === null || raw === '')
        return '';
    try {
        return JSON.stringify(JSON.parse(raw as string), null, 2);
    }
    catch {
        return String(raw);
    }
}
const PANEL_SPRING = { type: 'spring' as const, stiffness: 420, damping: 38 };
function ProcessPanel({ steps, tools, retries = [], label, onClose }: {
    steps?: readonly WorkNode[] | undefined;
    tools?: readonly WorkNode[] | undefined;
    retries?: readonly RetryEntry[] | undefined;
    label: string;
    onClose: () => void;
}) {
    useEscape(onClose);
    const items: PanelItem[] = [];
    for (const step of steps ?? []) {
        for (const [index, block] of (step?.blocks ?? []).entries()) {
            const text = String(block?.text ?? '').trim();
            if (text === '' || (block.kind !== 'reasoning' && block.kind !== 'text'))
                continue;
            items.push({ seq: seqOf(step) + index / 100, key: `s${seqOf(step)}:${index}`, kind: block.kind, text });
        }
    }
    turnCalls(tools).forEach(({ call, seq }, index) => items.push({ seq: seq + 0.5 + index / 1000, key: `c${call.callId ?? index}`, kind: 'tool', call }));
    for (const retry of retries)
        items.push({ seq: retry.seq, key: `r${retry.seq}`, kind: 'retry', retry });
    items.sort((a, b) => a.seq - b.seq);
    return createPortal(h(motion.div, { className: 'bt-process-scrim', initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 }, onMouseDown: (event: React.MouseEvent) => { if (event.target === event.currentTarget)
            onClose(); } }, h(motion.aside, { className: 'bt-process', role: 'dialog', 'aria-label': t('Work process'), initial: { x: 48, opacity: 0.6 }, animate: { x: 0, opacity: 1 }, exit: { x: 48, opacity: 0 }, transition: PANEL_SPRING }, <header><div><strong>{t('Work process')}</strong><span>{label}</span></div><button type='button' className='bt-process-close' aria-label={t('Close')} onClick={onClose}>×</button></header>, <ol>{items.map(item => <li key={item.key} data-kind={item.kind}>{item.kind === 'tool' ? h(ToolItem, { call: item.call })
        : item.kind === 'retry' ? <><div className='bt-process-tag'>{t('Model retry')} · {item.retry.cancelled ? t('Retry cancelled') : `${t('Retried')} ${item.retry.retry}/${item.retry.maximum}`}</div>{item.retry.failure ? <div className='bt-process-text'>{item.retry.failure}</div> : null}</> : item.kind === 'reasoning' ? <><div className='bt-process-tag'>{t('Thinking')}</div><div className='bt-process-text'>{item.text}</div></> 
        // A reply is already in the chat; here it is one line that opens.
        : <details><summary className='bt-process-reply'><span className='bt-process-tag'>{t('Reply')} · </span>{item.text.slice(0, 60) + (item.text.length > 60 ? '…' : '')}</summary><div className='bt-process-text'>{item.text}</div></details>}</li>)}</ol>)), document.body);
}
function ToolItem({ call }: {
    call: ToolCall;
}) {
    const done = call.kind === 'tool-result';
    const args = pretty(call.argsRaw ?? call.call?.argsRaw);
    const output = done ? contentText(call.content as never) : '';
    return <><div className='bt-process-tag'>{t('Tool')} · <code>{toolName(call as never) ?? '?'}</code>{done ? (call.isError ? <span className='bt-process-err'>{` · ${t('Failed')}`}</span> : null) : ` · ${t('Running')}`}</div>{args ? <details><summary>{t('Input')}</summary><pre>{args}</pre></details> : null}{output ? <details open={output.length < 600}><summary>{t('Output')}</summary><pre>{output}</pre></details> : null}</>;
}
export const PROCESS_CSS = `
.bt-work-line{display:inline-flex;align-items:center;gap:4px;margin:2px 0 6px;padding:2px 0;border:0;background:none;color:var(--bt-ink-3);font:inherit;font-size:13px;cursor:pointer}
.bt-work-line:hover{color:var(--bt-ink-2)}
.bt-work-chev{font-size:14px;line-height:1;transition:transform .2s ease}
.bt-work-line[aria-expanded=true] .bt-work-chev{transform:rotate(90deg)}
.bt-work-fold{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},opacity .2s ease}
.bt-work-fold[data-open]{grid-template-rows:1fr;opacity:1}
.bt-work-fold-in{overflow:hidden;min-height:0}
.bt-work-steps{list-style:none;margin:0 0 6px;padding:2px 0 2px 10px;border-left:.5px solid var(--bt-line-2);display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--bt-ink-2)}
.bt-work-steps li{display:flex;align-items:baseline;gap:8px;min-width:0}
.bt-work-kind{flex:none;color:var(--bt-ink-3)}
.bt-work-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-work-steps li[data-kind=tool] .bt-work-text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.bt-work-steps li[data-failed] .bt-work-text{color:var(--bt-danger)}
.bt-work-all{margin:0 0 8px 10px;padding:2px 8px;border:.5px solid var(--bt-line-2);border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-work-all:hover{background:var(--bt-hover)}
.bt-process-scrim{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.18);display:flex;justify-content:flex-end;animation:bt-fade .18s ease-out}
.bt-process{width:min(480px,92vw);height:100%;display:flex;flex-direction:column;background:var(--bt-main);color:var(--bt-ink);box-shadow:-8px 0 32px rgba(0,0,0,.14);font-size:14px;animation:bt-pane-in ${PANEL_LINGER_MS}ms ${EASE_PANEL}}
@media (prefers-reduced-motion:reduce){.bt-work-fold,.bt-work-chev{transition:none}.bt-process-scrim,.bt-process{animation:none}}
.bt-process header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--bt-line-2)}
.bt-process header div{display:flex;flex-direction:column;gap:2px}
.bt-process header span{font-size:12px;color:var(--bt-ink-3)}
.bt-process-close{border:0;background:none;font-size:22px;line-height:1;color:inherit;cursor:pointer;padding:4px 8px;border-radius:6px}
.bt-process-close:hover{background:var(--bt-hover)}
.bt-process ol{list-style:none;margin:0;padding:12px 20px 24px;overflow:auto;flex:1}
.bt-process li{padding:10px 0;border-bottom:1px dashed var(--bt-line-2)}
.bt-process-tag{font-size:12px;color:var(--bt-ink-3);margin-bottom:4px}
.bt-process-tag code{font-size:12px}
.bt-process-err{color:var(--bt-danger)}
.bt-process-reply{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-process-text{white-space:pre-wrap;line-height:1.6}
.bt-process li[data-kind=reasoning] .bt-process-text{color:var(--bt-ink-2)}
.bt-process details summary{cursor:pointer;font-size:12px;color:var(--bt-ink-2);margin:4px 0}
.bt-process pre{margin:4px 0 0;padding:8px 10px;max-height:320px;overflow:auto;border-radius:8px;background:var(--bt-hover);font-size:12px;white-space:pre-wrap;word-break:break-word}
:is(.bt-work-line,.bt-work-all,.bt-process-close,.bt-process details summary):focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
`;
