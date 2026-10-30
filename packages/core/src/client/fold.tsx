import { createElement as h, useMemo, useState } from 'react';
import { t } from './i18n.ts';
// A message past FOLD_AT shows folded: its first lines, then "Show all". A Bot's reply in
// its own chat is what the user reads, so it folds only past FOLD_HUGE, where rendering
// all of it would slow the chat down.
export interface FoldLimit {
    readonly chars: number;
    readonly lines: number;
}
export const FOLD_AT: FoldLimit = { chars: 1500, lines: 25 };
export const FOLD_HUGE: FoldLimit = { chars: 20000, lines: Infinity };
const ALWAYS: FoldLimit = { chars: -1, lines: 0 };
const PREVIEW_LINES = 10;
const PREVIEW_CHARS = 600;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// More than `max` lines, counted only as far as needed.
function moreLines(text: string, max: number): boolean {
    let lines = 1;
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
        if (++lines > max)
            return true;
    }
    return false;
}
// The start of a long text, cut at a line end (or inside a very long first line). In
// Markdown a code fence left open is closed, so the preview does not run on as code.
// Null when `text` is within `limit`.
export function foldPreview(text: string, limit: FoldLimit = FOLD_AT, markdown = true): string | null {
    if (text.length <= limit.chars && !moreLines(text, limit.lines))
        return null;
    let head = text.split('\n', PREVIEW_LINES).join('\n');
    if (head.length > PREVIEW_CHARS) {
        const cut = head.lastIndexOf('\n', PREVIEW_CHARS);
        const end = cut > 0 ? cut : PREVIEW_CHARS;
        const code = head.charCodeAt(end - 1);
        head = head.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
    }
    if (!markdown)
        return head;
    let open: string | null = null;
    for (const line of head.split('\n')) {
        const marker = (FENCE.exec(line) ?? [])[1];
        if (marker === undefined)
            continue;
        if (open === null)
            open = marker;
        else if (marker[0] === open[0] && marker.length >= open.length)
            open = null;
    }
    return open === null ? head : `${head}\n${open}`;
}
// The line a long message that went as a file starts with (the host's attachLong) is
// for the model; the chat shows "Show all" instead.
export const stripLongNote = (text: string): string => text.replace(/^\[A long message: \d+ characters\.[^\]\n]*\]\n/, '');
// The whole text a folded message may load on demand.
export interface WholeText {
    readonly length: number;
    readonly load?: () => Promise<{
        readonly text: string;
        readonly whole: boolean;
    } | undefined | null>;
}
export interface FoldOptions {
    readonly limit?: FoldLimit;
    readonly whole?: WholeText;
    readonly live?: boolean;
    readonly markdown?: boolean;
}
export interface FoldResult {
    readonly shown: string;
    readonly folded?: boolean;
    readonly control: ReturnType<typeof h> | null;
}
type ReadState = 'loading' | {
    readonly text?: string;
    readonly whole: boolean;
} | undefined;
// `shown`: the text to show now; `control`: what goes under it (null for a short text).
// `whole`, when `text` is only the start of the message: its `length`, and `load()`,
// which reads it whole ({ text, whole }). `live`: still streaming, never folded.
// `markdown`: false for plain text.
export function useFold(text: string, { limit = FOLD_AT, whole, live = false, markdown = true }: FoldOptions = {}): FoldResult {
    const [open, setOpen] = useState(false);
    const [read, setRead] = useState<ReadState>();
    const cut = whole !== undefined && whole.length > text.length;
    // A message kept only in part folds whatever the length of its start.
    const preview = useMemo(() => (live ? null : foldPreview(text, cut ? ALWAYS : limit, markdown)), [text, live, limit, markdown, cut]);
    if (preview === null)
        return { shown: text, control: null };
    const count = (cut ? (whole as WholeText).length : text.length).toLocaleString();
    if (!open) {
        const show = async (): Promise<void> => {
            setOpen(true);
            if (!cut || read !== undefined || whole?.load === undefined)
                return;
            setRead('loading');
            setRead((await whole.load()) ?? { whole: false });
        };
        return { shown: preview, folded: true, control: <span className='bt-fold'><button type='button' className='bt-more' onClick={show}>{t('Show all · {count} characters', { count })}</button></span> };
    }
    const loaded = read !== undefined && read !== 'loading' && typeof read.text === 'string' ? { text: read.text, whole: read.whole } : undefined;
    const note = !cut || read === undefined || read === 'loading' || loaded?.whole ? null
        : loaded !== undefined && loaded.text.length > text.length ? t('Showing the first {count} characters', { count: loaded.text.length.toLocaleString() })
            : t('Only the start of this message is kept here');
    return {
        shown: loaded?.text ?? text,
        control: <span className='bt-fold'>{note ? <span className='bt-fold-note'>{note}</span> : null}<button type='button' className='bt-more' onClick={() => setOpen(false)}>{t('Show less')}</button></span>,
    };
}
