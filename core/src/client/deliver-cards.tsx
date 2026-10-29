// The files a turn delivered (2026-10-28 files-and-library): a row of cards under a
// Bot's reply, and the preview a card opens. The host's turn-files and library
// endpoints are read-only; every path is workspace-relative, and downloads go through
// workspace-download, which works behind the web build's password too.
import { createElement as h, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { call } from './api.ts';
import { MarkdownText } from './primitives.tsx';
import { CloseIcon, FileKindIcon } from './icons.tsx';
import type { DeliverKind } from './icons.tsx';
import { formatBytes, mediaKind, saveBlob, toBlob, toBytes, typeLabel } from './files-panel.ts';
import type { DownloadFile } from './files-panel.ts';
import { useEscape } from './overlay-hooks.ts';
import { t } from './i18n.ts';

/** One file the host recorded for a turn; `path` is workspace-relative. */
export interface FileCard {
    readonly name: string;
    readonly path: string;
    readonly size: number;
    readonly createdAt: number;
}
/** A shelf entry, as the library endpoint reports it. */
export interface LibraryItem extends FileCard {
    readonly sessionId: string;
    readonly turn: number | null;
    readonly ownerId: string | null;
}

// Beyond this the download itself is the slow part, whatever the preview does.
export const BIG_FILE = 64 * 1024 * 1024;
// A previewed text body stops here; more would only scroll past what anyone reads.
const TEXT_LIMIT = 64 * 1024;

const messageOf = (error: unknown): string => (error as { readonly message?: string } | undefined)?.message ?? String(error);
const extension = (name: string): string => (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase();

const KIND_EXTENSIONS: readonly (readonly [DeliverKind, readonly string[]])[] = [
    ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']],
    ['sheet', ['csv', 'tsv', 'xls', 'xlsx', 'ods']],
    ['media', ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']],
    ['code', ['txt', 'log', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'kt', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf']],
    ['document', ['pdf', 'md', 'markdown', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'rtf', 'epub']],
];
/** What a file is, by extension, for the card's icon and the library's type filter. */
export function fileKind(name: string): DeliverKind {
    const ext = extension(name);
    for (const [kind, list] of KIND_EXTENSIONS)
        if (list.includes(ext))
            return kind;
    return 'other';
}
export const KIND_LABELS: readonly (readonly [DeliverKind, string])[] = [
    ['image', 'Images'], ['document', 'Documents'], ['sheet', 'Spreadsheets'], ['code', 'Code'], ['media', 'Media'], ['other', 'Other'],
];

export type TimeBucket = 'today' | 'week' | 'earlier';
/** When a file arrived, in the browser's own calendar, for the library's time filter. */
export function timeBucket(createdAt: number, now = Date.now()): TimeBucket {
    const at = new Date(createdAt);
    const today = new Date(now);
    if (at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate())
        return 'today';
    return now - createdAt < 7 * 86_400_000 ? 'week' : 'earlier';
}

/** No browser tag renders these; the preview says so and hands them to the download. */
const PREVIEWABLE_TEXT = /\.(txt|log|json|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|swift|kt|sql|sh|bash|zsh|ps1|html?|css|scss|less|xml|ya?ml|toml|ini|conf|csv|tsv|md|markdown)$/i;
type PreviewKind = 'image' | 'pdf' | 'markdown' | 'text' | 'media' | 'unsupported';
function previewKind(name: string): PreviewKind {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name))
        return 'image';
    if (/\.pdf$/i.test(name))
        return 'pdf';
    if (/\.(md|markdown)$/i.test(name))
        return 'markdown';
    if (mediaKind(name) !== null)
        return 'media';
    if (PREVIEWABLE_TEXT.test(name))
        return 'text';
    return 'unsupported';
}

// One answer per (session, turn) for as long as the page is open: the chat remounts its
// tail cells as the transcript scrolls, and each turn's files never change after it ends.
const turnFilesCache = new Map<string, readonly FileCard[]>();
/** The files a turn left behind, or null while they load (or failed to). */
export function useTurnFiles(sessionId: string, turn: number): readonly FileCard[] | null {
    const key = `${sessionId}:${turn}`;
    const [files, setFiles] = useState<readonly FileCard[] | null | undefined>(turnFilesCache.get(key));
    useEffect(() => {
        if (turnFilesCache.has(key)) {
            setFiles(turnFilesCache.get(key));
            return undefined;
        }
        let stopped = false;
        call<{ readonly files?: readonly FileCard[] }>('turn-files', { sessionId, turn })
            .then((answer) => {
                const list = answer?.files ?? [];
                turnFilesCache.set(key, list);
                if (!stopped)
                    setFiles(list);
            })
            .catch(() => {
                if (!stopped)
                    setFiles(null);
            });
        return () => {
            stopped = true;
        };
    }, [key]);
    return files ?? null;
}

export interface FileCardsProps {
    readonly files: readonly FileCard[];
    readonly sessionId?: string | undefined;
    /** Called instead of the built-in preview when the card is opened. */
    readonly onOpen?: ((file: FileCard) => void) | undefined;
}
/** A row of file cards; a card opens the preview (or `onOpen`) and shows what it is. */
export function FileCards({ files, sessionId, onOpen }: FileCardsProps) {
    const [preview, setPreview] = useState<FileCard | null>(null);
    return <div className='bt-dcards' role='group' aria-label={t('Delivered files')}>{files.map(file => <button key={file.path} type='button' className='bt-dcard' title={file.path} onClick={() => (onOpen ? onOpen(file) : setPreview(file))}>
        <span className='bt-dcard-icon' aria-hidden><FileKindIcon kind={fileKind(file.name)} /></span>
        <span className='bt-dcard-copy'>
            <span className='bt-dcard-name'>{file.name}</span>
            <span className='bt-dcard-meta'>{[formatBytes(file.size), typeLabel(file.name)].filter(Boolean).join(' · ')}</span>
            {file.size > BIG_FILE ? <span className='bt-dcard-big'>{t('Large file. The download may take a while.')}</span> : null}
        </span>
    </button>)}{preview ? createPortal(<FilePreview file={preview} sessionId={sessionId} onClose={() => setPreview(null)} />, document.body) : null}</div>;
}

export interface FilePreviewProps {
    readonly file: FileCard;
    readonly sessionId?: string | undefined;
    readonly onClose: () => void;
}
/** The modal a file card opens: a preview where the browser has one, a card where not. */

function isDiffContent(name: string, content: string): boolean {
    if (/\.(diff|patch)$/i.test(name)) return true;
    return content.startsWith('diff --git') || content.startsWith('--- a/') || (content.includes('\n@@ -') && content.includes('\n+++ '));
}

function DiffViewer({ text }: { text: string }) {
    const lines = text.split('\n');
    return <div className='bt-diff-view' role='region' aria-label={t('File changes')}>
        {lines.map((line, idx) => {
            const isAdd = line.startsWith('+') && !line.startsWith('+++');
            const isDel = line.startsWith('-') && !line.startsWith('---');
            const isHunk = line.startsWith('@@');
            const isMeta = line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ');
            const type = isAdd ? 'add' : isDel ? 'del' : isHunk ? 'hunk' : isMeta ? 'meta' : 'ctx';
            return <div key={idx} className={`bt-diff-line bt-diff-${type}`}>
                <span className='bt-diff-num'>{idx + 1}</span>
                <span className='bt-diff-code'>{line}</span>
            </div>;
        })}
    </div>;
}

export function FilePreview({ file, sessionId, onClose }: FilePreviewProps) {
    useEscape(onClose);
    const kind = previewKind(file.name);
    const media = mediaKind(file.name);
    const [url, setUrl] = useState('');
    const [text, setText] = useState<{ readonly body: string; readonly cut: boolean } | null>(null);
    const [problem, setProblem] = useState('');
    const [busy, setBusy] = useState(false);
    const blob = useRef<Blob | null>(null);
    // One download serves the preview and the save button; the URL dies with the modal.
    useEffect(() => {
        let dead = false;
        let made = '';
        call<DownloadFile>('workspace-download', { path: file.path, sessionId })
            .then((answer) => {
                if (dead)
                    return;
                blob.current = toBlob(answer);
                if (kind === 'text' || kind === 'markdown') {
                    const whole = new TextDecoder().decode(toBytes(answer.data));
                    setText({ body: whole.slice(0, TEXT_LIMIT), cut: whole.length > TEXT_LIMIT });
                }
                else {
                    made = URL.createObjectURL(blob.current);
                    setUrl(made);
                }
            })
            .catch((failure) => {
                if (!dead)
                    setProblem(messageOf(failure));
            });
        return () => {
            dead = true;
            if (made !== '')
                URL.revokeObjectURL(made);
        };
    }, [file.path, sessionId, kind]);
    const download = (): void => {
        if (blob.current) {
            saveBlob(blob.current, file.name);
            return;
        }
        if (busy)
            return;
        setBusy(true);
        call<DownloadFile>('workspace-download', { path: file.path, sessionId })
            .then((answer) => {
                blob.current = toBlob(answer);
                saveBlob(blob.current, answer.name || file.name);
            })
            .catch(failure => setProblem(messageOf(failure)))
            .finally(() => setBusy(false));
    };
    const meta = [formatBytes(file.size), typeLabel(file.name)].filter(Boolean).join(' · ');
    // What shows is settled by the name alone; the bytes only decide when it can show.
    let body: ReactNode = null;
    if (problem !== '')
        body = <p className='bt-fpreview-note' role='alert'>{problem}</p>;
    else if (kind === 'text' || kind === 'markdown') {
        const isDiff = text !== null && isDiffContent(file.name, text.body);
        body = text === null ? <div className='bt-fpreview-loading'>{t('Loading…')}</div> : <div className='bt-fpreview-text'>
            {isDiff ? <DiffViewer text={text.body} /> : kind === 'markdown' ? <MarkdownText text={text.body} /> : <pre>{text.body}</pre>}
            {text.cut ? <p className='bt-fpreview-note'>{t('Preview shows the first {size}.', { size: formatBytes(TEXT_LIMIT) })}</p> : null}
        </div>;
    }
    else if (kind === 'image')
        body = url === '' ? <div className='bt-fpreview-loading'>{t('Loading…')}</div> : <img className='bt-fpreview-image' src={url} alt={file.name}/>;
    else if (kind === 'pdf')
        body = url === '' ? <div className='bt-fpreview-loading'>{t('Loading…')}</div> : <iframe className='bt-fpreview-frame' src={url} title={file.name}/>;
    else if (media === 'audio')
        body = url === '' ? <div className='bt-fpreview-loading'>{t('Loading…')}</div> : <audio className='bt-fpreview-audio' controls src={url}/>;
    else if (media === 'video')
        body = url === '' ? <div className='bt-fpreview-loading'>{t('Loading…')}</div> : <video className='bt-fpreview-video' controls src={url}/>;
    else
        body = <div className='bt-fpreview-none'>
            <span className='bt-dcard-icon' aria-hidden><FileKindIcon kind={fileKind(file.name)} size={26} /></span>
            <p className='bt-fpreview-note'>{t('This file type has no preview. Download it to open it on your computer.')}</p>
        </div>;
    return <div className='bt-fpreview-layer'>
        <div className='bt-scrim' onMouseDown={onClose}/>
        <div className='bt-fpreview' role='dialog' aria-modal aria-label={t('File preview')}>
            <div className='bt-fpreview-head'>
                <span className='bt-dcard-icon' aria-hidden><FileKindIcon kind={fileKind(file.name)} /></span>
                <span className='bt-fpreview-copy'>
                    <span className='bt-fpreview-name'>{file.name}</span>
                    <span className='bt-fpreview-meta'>{file.path}{meta !== '' ? ` · ${meta}` : ''}</span>
                    {file.size > BIG_FILE ? <span className='bt-dcard-big'>{t('Large file. The download may take a while.')}</span> : null}
                </span>
                <button type='button' className='bt-icon-btn' aria-label={t('Close')} onClick={onClose}><CloseIcon /></button>
            </div>
            <div className='bt-fpreview-body'>{body}</div>
            <div className='bt-fpreview-foot'>
                <button type='button' className='bt-fpreview-download' data-busy={busy || undefined} onClick={download}>{t('Download')}</button>
            </div>
        </div>
    </div>;
}
