import { Fragment, createElement as h, useState } from 'react';
// DSH's drawing helpers for the blocks it renders itself; the standalone product
// draws plain versions of the same parts, and canDrawUserMessages stays true.
const ui = {
  projectUserText: (text: string, ..._rest: readonly unknown[]): string => { void _rest; return text },
  fileExtension: (name: string): string | undefined => name.split('.').at(-1),
  fileSizeText: (bytes: number | undefined): string | undefined => (bytes === undefined ? undefined : bytes < 1024 ? `${String(bytes)} B` : `${String(Math.round(bytes / 1024))} KB`),
  FileTypeIcon: null,
  JsonBlock: null,
} as const
import { mentionSpans } from '../shared/mentions.ts';
import { BotMark } from './mark.tsx';
import { CheckIcon, CopyIcon } from './icons.tsx';
import { dateLocale, t } from './i18n.ts';
import { clockLabel, messageClock } from './text.ts';
import { useFold } from './fold.tsx';
import type { MentionTarget } from '../shared/mentions.ts';
// One block of a message: text, an attachment, or something DSH draws itself.
export interface ContentBlock {
    type?: string;
    text?: string;
    attachment?: {
        name: string;
        bytes?: number;
    };
}
export interface TextPart {
    text: string;
}
export interface MentionPart {
    bot: MentionTarget & {
        id: string;
        name: string;
    };
    label: string;
}
export interface EveryonePart {
    bots: readonly (MentionTarget & { id: string; name: string })[];
    label: string;
}
export type UserTextPart = TextPart | MentionPart | EveryonePart;
interface UserMessageCellProps {
    node: {
        kind?: string;
        data?: {
            content?: unknown;
            referenceLabels?: readonly string[];
            skillNames?: readonly string[];
            time?: number;
        };
    };
    sessionId: string;
    useRoster: <T>(select: (value: UserRoster) => T) => T;
    actions: {
        openSession: (id: string) => void;
    };
    renderMessageImages?: (props: {
        images: readonly unknown[];
        align: string;
        compact: boolean;
    }) => ReturnType<typeof h> | null;
    openFile?: (path: string) => void;
    openSkill?: (name: string) => void;
}
// The roster fields a user message reads to resolve its mentions.
interface UserRoster {
    bots: (MentionTarget & {
        id: string;
    })[];
    byId: Record<string, {
        id: string;
        name: string;
    } | undefined>;
    roomsById: Record<string, {
        members: readonly string[];
    } | undefined>;
}
// -------------------------------------------------------------------------
// The user's own messages. DSH draws every "@word" in them as a file reference, and
// cuts it at the first space, so "@新 Bot" showed as a file "新". Here the Bot mentions
// are cut out first, by the rule the group host calls them with; DSH's own drawing
// keeps everything else (files, conversation references, skills).
// DSH releases without the text projection keep their own bubble.
export const canDrawUserMessages = () => typeof ui.projectUserText === 'function';
export function contentParts(content: unknown): {
    text: string;
    attachments: ContentBlock[];
    rest: ContentBlock[];
} {
    const texts: string[] = [];
    const attachments: ContentBlock[] = [];
    const rest: ContentBlock[] = [];
    for (const block of (Array.isArray(content) ? content : []) as ContentBlock[]) {
        if (block?.type === 'text' && typeof block.text === 'string')
            texts.push(block.text);
        else if ((block?.type === 'image' || block?.type === 'file') && block.attachment !== undefined)
            attachments.push(block);
        else
            rest.push(block);
    }
    // Joined as the group host joins them, so a mention never spans two blocks here only.
    return { text: texts.join('\n'), attachments, rest };
}
// In a group only its members are called; elsewhere a mention opens that Bot's chat.
export function mentionableBots(roster: UserRoster, sessionId: string): (MentionTarget & {
    id: string;
})[] {
    const room = roster.roomsById[sessionId];
    if (room)
        return room.members.map(id => roster.byId[id]).filter((bot): bot is MentionTarget & {
            id: string;
        } => bot !== undefined);
    return roster.byId[sessionId] ? roster.bots : [];
}
// Runs of plain text and Bot mentions, in order.
export function userTextParts(text: string, bots: readonly MentionTarget[], referenceLabels: readonly string[] = [], everyoneBots: readonly MentionTarget[] = []): UserTextPart[] {
    const parts: UserTextPart[] = [];
    let cursor = 0;
    for (const span of mentionSpans(text, bots, { references: referenceLabels })) {
        if (span.start > cursor)
            parts.push({ text: text.slice(cursor, span.start) });
        if ('bot' in span)
            parts.push({ bot: span.bot as MentionPart['bot'], label: text.slice(span.start + 1, span.end) });
        else if (everyoneBots.length > 0)
            parts.push({ bots: everyoneBots as EveryonePart['bots'], label: text.slice(span.start + 1, span.end) });
        else
            parts.push({ text: text.slice(span.start, span.end) });
        cursor = span.end;
    }
    if (cursor < text.length)
        parts.push({ text: text.slice(cursor) });
    return parts;
}
function UserText({ text, bots, everyoneBots, referenceLabels, skillNames, references, actions }: {
    text: string;
    bots: readonly MentionTarget[];
    everyoneBots: readonly MentionTarget[];
    referenceLabels: readonly string[];
    skillNames: readonly string[];
    references: {
        openFile: (path: string) => void;
        openSkill: (name: string) => void;
    } | undefined;
    actions: {
        openSession: (id: string) => void;
    };
}) {
    return userTextParts(text, bots, referenceLabels, everyoneBots).map((part, index) => ('bot' in part
        ? <button key={index} type='button' className='bt-umention' title={`@${part.bot.name}`} onClick={() => actions.openSession(part.bot.id)}><BotMark bot={part.bot} size={16} />{part.label}</button>
        : 'bots' in part
            ? <span key={index} className='bt-umention bt-everyone-mention' title={t('Every member')}>{part.bots.map(bot => <BotMark key={bot.id} bot={bot} size={16} />)}{part.label}</span>
            : <span key={index}>{ui.projectUserText(part.text, referenceLabels, skillNames, 'skill', references)}</span>));
}
function Attachments({ attachments, renderMessageImages }: {
    attachments: ContentBlock[];
    renderMessageImages?: UserMessageCellProps['renderMessageImages'];
}) {
    const compact = attachments.length > 1;
    return <div className='bt-uattach'>{attachments.map((block, index) => {
        if (block.type === 'image') {
            return renderMessageImages ? <>{renderMessageImages({ images: [{ attachment: block.attachment }], align: 'end', compact })}</> : null;
        }
        const file = block.attachment;
        if (file === undefined)
            return null;
        const meta = [ui.fileExtension?.(file.name)?.toUpperCase().slice(0, 8), ui.fileSizeText?.(file.bytes)].filter(Boolean).join(' · ');
        return <span key={index} className='bt-ufile' title={file.name}>{ui.FileTypeIcon ? h(ui.FileTypeIcon, { path: file.name, className: 'bt-ufile-icon' }) : null}<span className='bt-ufile-text'><span className='bt-ufile-name'>{file.name}</span>{meta ? <span className='bt-ufile-meta'>{meta}</span> : null}</span></span>;
    })}</div>;
}
function CopyButton({ text }: {
    text: string;
}) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000); });
    };
    return <button type='button' className='bt-tool' aria-label={copied ? t('Copied') : t('Copy')} title={copied ? t('Copied') : t('Copy')} onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />}</button>;
}
const clock = (time: number | undefined): string | undefined => (typeof time === 'number' ? new Date(time).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' }) : undefined);
// A sent message, or one that joined a running turn ("steering").
export function UserMessageCell({ node, sessionId, useRoster, actions, renderMessageImages, openFile, openSkill }: UserMessageCellProps) {
    const roster = useRoster(value => value);
    const data = node.data ?? {};
    const { text, attachments, rest } = contentParts(data.content);
    const referenceLabels = data.referenceLabels ?? [] as readonly string[];
    const references = openFile && openSkill ? { openFile, openSkill } : undefined;
    const steering = node.kind === 'steering';
    const time = typeof data.time === 'number' && Number.isFinite(data.time) ? data.time : undefined;
    const groupTime = roster.roomsById?.[sessionId] && time !== undefined ? messageClock(time) : undefined;
    const { shown, folded, control } = useFold(text, { markdown: false });
    const mentionBots = mentionableBots(roster, sessionId);
    const room = roster.roomsById[sessionId];
    const body = h(UserText, { text: shown, bots: mentionBots, everyoneBots: room ? mentionBots : [], referenceLabels, skillNames: data.skillNames ?? [], references, actions });
    return <div className='bt-umsg' data-steering={steering || undefined}><div className='bt-ustack'>{attachments.length > 0 ? <Attachments attachments={attachments} renderMessageImages={renderMessageImages} /> : null}{text !== '' || rest.length > 0 ? <div className='bt-ubody' title={clock(data.time)} data-folded={folded || undefined}>{control ? <div className='bt-fold-body'>{body}</div> : body}{control}{rest.map((block, index) => (ui.JsonBlock ? h(ui.JsonBlock, { key: index, label: t('Content'), payload: block }) : null))}</div> : null}{referenceLabels.length > 0 ? <div className='bt-urefs'>{t('Referenced {labels}', { labels: referenceLabels.join(t(', ')) })}</div> : null}{groupTime && time !== undefined ? <div className='bt-utime' title={clockLabel(time)}>{groupTime}</div> : null}</div>{text === '' ? null : <div className='bt-utools'><CopyButton text={text} /></div>}</div>;
}
export const USER_MESSAGE_CSS = `
.bt-umsg{display:flex;flex-direction:row-reverse;align-items:center;justify-content:flex-start;gap:4px}
.bt-ustack{min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702),82%);display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.bt-ubody{max-width:100%;box-sizing:border-box;background:var(--bt-user);color:var(--bt-user-ink);border-radius:18px;padding:7px 12px;font-size:var(--dsh-content-font-size,14px);line-height:calc(var(--dsh-content-font-size,14px) + 8px);white-space:pre-wrap;word-break:break-word}
.bt-ubody a{color:inherit}
.bt-umention{display:inline-flex;align-items:center;gap:3px;vertical-align:-3px;max-width:100%;padding:0 1px;border:0;background:none;color:inherit;font:inherit;font-weight:600;line-height:inherit;cursor:pointer;border-radius:6px;white-space:nowrap}
.bt-umention:hover{text-decoration:underline;text-underline-offset:2px}
.bt-everyone-mention{cursor:default;flex-wrap:wrap}
.bt-everyone-mention:hover{text-decoration:none}
.bt-umention>:first-child{flex:none}
.bt-uattach{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:100%}
.bt-ufile{display:inline-flex;align-items:center;gap:10px;box-sizing:border-box;width:240px;min-height:64px;padding:8px 12px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card)}
.bt-ufile-icon{flex:none;width:28px;height:28px}
.bt-ufile-text{display:flex;flex-direction:column;min-width:0}
.bt-ufile-name{font-size:14px;line-height:22px;font-weight:500;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-ufile-meta{font-size:12px;line-height:15px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-urefs{font-size:13px;line-height:18px;color:var(--bt-ink-3)}
.bt-utools{display:flex;flex:none;gap:2px;opacity:0;visibility:hidden;transition:opacity .12s ease,visibility .12s}
.bt-umsg:hover .bt-utools,.bt-umsg:focus-within .bt-utools{opacity:1;visibility:visible}
`;
