import { type Ref, createElement as h, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { colorOf } from './characters.ts';
import { GRADIENTS, paintCss } from './inks.ts';
import { BotAvatar, RoomAvatar } from './mark.tsx';
import { ChatsIcon } from './icons.tsx';
import { reducedMotion, useGlide } from './motion.tsx';
import { dateLocale, t } from './i18n.ts';
import { DAY_MS, HOUR_MS, compact, dayKey, hourMs, percent } from './usage-data.ts';
import type { UsageBucket, UsageSum } from './usage-data.ts';
import type { Glyph, PageRange, UsageOwner, UsageRoster, } from './usage-page-types.ts';
export const rangeLabel = (id: string): string | undefined => {
    const labels: Record<string, string> = { '24h': t('24 hours'), '7d': t('7 days'), '30d': t('30 days'), '12w': t('12 weeks'), '12m': t('12 months') };
    return labels[id];
};
export const unitLabel = (unit: string): string | undefined => {
    const labels: Record<string, string> = { hour: t('Per hour'), day: t('Per day'), week: t('Per week'), month: t('Per month') };
    return labels[unit];
};
export const MODEL_INKS: readonly string[] = ['deepseek', 'tangerine', 'green', 'violet', 'sky', 'rose', 'yellow', 'cyan', 'magenta', 'brown'];
// Token kinds, from the solid output to the faint cache hits.
export type PartKey = 'output' | 'input' | 'cacheRead';
export const PARTS: readonly (readonly [
    PartKey,
    number
])[] = [['output', 1], ['input', 0.6], ['cacheRead', 0.32]];
export const partLabel = (part: string): string | undefined => {
    const labels: Record<string, string> = { output: t('Output'), input: t('Input'), cacheRead: t('Cache hit') };
    return labels[part];
};
// A color a step softer than the Bot's own, mixed into the card so stacks stay opaque.
// A gradient softens stop by stop.
export const soften = (paint: string, strength = 1): string => {
    const mix = (color: string): string => `color-mix(in srgb, ${color} ${Math.round(88 * strength)}%, var(--bt-card))`;
    return paint.startsWith('linear-gradient(') ? paint.replace(/#[0-9a-f]{6}/gi, mix) : mix(paint);
};
export const full = (count: number): string => new Intl.NumberFormat(dateLocale()).format(Math.round(count));
export const hitRate = (sum: UsageSum): string => percent(sum.cacheRead, sum.input + sum.cacheRead);
export const dates = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => new Intl.DateTimeFormat(dateLocale(), { timeZone: 'UTC', ...options });
export const hourText = (ms: number): string => `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`;
export const yearOf = (ms: number): number => new Date(ms).getUTCFullYear();
// Day keys `from` to `to` as one short phrase, with the year only when it is not this one.
export function spanText(from: string, to: string): string {
    const start = hourMs(from);
    const end = hourMs(to);
    const year = new Date().getFullYear();
    const format = dates(yearOf(start) !== year || yearOf(end) !== year ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
    // Not formatRange: in Chinese it falls back to numbers like 10/1 – 10/9.
    return from === to ? format.format(start) : `${format.format(start)} – ${format.format(end)}`;
}
export const daysText = (count: number): string => (count === 1 ? t('1 day') : t('{count} days', { count }));
export const lastText = (range: PageRange): string => (range.from ? spanText(range.from, range.to!) : t('Last {range}', { range: rangeLabel(range.id) }));
export function compareText(range: PageRange): string {
    if (!range.from)
        return t('Compared with the {range} before', { range: rangeLabel(range.id) });
    return range.days === 1 ? t('Compared with the day before') : t('Compared with the {count} days before', { count: range.days });
}
export function tickOf(range: PageRange, bucket: UsageBucket): string {
    if (range.unit === 'hour') {
        // Over two picked days, midnight names its day.
        return range.days !== undefined && range.days > 1 && new Date(bucket.start).getUTCHours() === 0 ? dates({ month: 'numeric', day: 'numeric' }).format(bucket.start) : hourText(bucket.start);
    }
    if (range.unit === 'month')
        return dates({ month: 'short' }).format(bucket.start);
    return dates({ month: 'numeric', day: 'numeric' }).format(bucket.start);
}
export function titleOf(range: PageRange, bucket: UsageBucket): string {
    if (range.unit === 'hour')
        return `${dates({ month: 'short', day: 'numeric' }).format(bucket.start)} ${hourText(bucket.start)}–${hourText(bucket.start + HOUR_MS)}`;
    if (range.unit === 'day')
        return dates({ month: 'long', day: 'numeric', weekday: 'short' }).format(bucket.start);
    if (range.unit === 'week')
        return spanText(dayKey(bucket.start), dayKey((bucket.end ?? bucket.start + 7 * DAY_MS) - DAY_MS));
    // A picked span can cut its first or last month short.
    if (bucket.end && (new Date(bucket.start).getUTCDate() !== 1 || new Date(bucket.end).getUTCDate() !== 1))
        return spanText(dayKey(bucket.start), dayKey(bucket.end - DAY_MS));
    return dates({ year: 'numeric', month: 'long' }).format(bucket.start);
}
// The number eases to each new value.
export function useTween(value: number): number {
    const [shown, setShown] = useState(0);
    const from = useRef(0);
    useEffect(() => {
        if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
            from.current = value;
            setShown(value);
            return undefined;
        }
        const begin = from.current;
        const started = performance.now();
        let frame = 0;
        const step = (now: number): void => {
            const progress = Math.min(1, (now - started) / 650);
            from.current = begin + (value - begin) * (1 - (1 - progress) ** 3);
            setShown(from.current);
            if (progress < 1)
                frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [value]);
    return shown;
}
export const glyphBox = (size: number, icon: Glyph): ReactElement => <span className='bt-us-glyph' style={{ width: size, height: size }}>{h(icon)}</span>;
export interface ModelGlyphProps {
    name: string;
    paint: string;
    size: number;
}
export function ModelGlyph({ name, paint, size }: ModelGlyphProps): ReactElement {
    return <span className='bt-us-model' aria-hidden style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `color-mix(in srgb, ${paint} 20%, var(--bt-card))`, color: `color-mix(in srgb, ${paint} 72%, var(--bt-ink))` }}>{(name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()}</span>;
}
export interface Face {
    readonly kind: string;
    readonly name: string;
    readonly sub: string;
    readonly paint: string;
    readonly stops?: readonly (readonly [
        number,
        string
    ])[] | undefined;
    readonly glyph: (size: number) => ReactElement;
}
// A Bot shows in its own color and character; a group chat and the other sessions in gray.
export function ownerFace(owner: UsageOwner, roster: UsageRoster): Face {
    if (owner.kind === 'bot') {
        const bot = roster.byId[owner.id] ?? { id: owner.id, name: owner.name };
        const name = bot.name || owner.name || t('Deleted Bot');
        const role = bot.role?.trim() ?? '';
        return {
            kind: 'bot', name, sub: owner.deleted ? t('Deleted') : role.toLowerCase() === name.toLowerCase() ? '' : role,
            paint: paintCss(colorOf(bot)), stops: GRADIENTS[colorOf(bot)], glyph: size => h(BotAvatar, { bot, size, badge: false, live: false }),
        };
    }
    if (owner.kind === 'room') {
        const room = roster.roomsById[owner.id];
        return {
            kind: 'room', name: owner.name || t('Deleted group chat'), sub: owner.deleted ? t('Deleted') : t('Group chat'),
            paint: 'var(--bt-us-rest)', glyph: size => (room ? h(RoomAvatar, { room, roster, size }) : glyphBox(size, ChatsIcon)),
        };
    }
    if (owner.kind === 'agent') {
        return {
            kind: 'agent', name: owner.name || 'Agent', sub: owner.deleted ? t('Deleted') : '',
            paint: 'var(--bt-us-rest)', glyph: size => glyphBox(size, ChatsIcon),
        };
    }
    return { kind: 'other', name: t('Other'), sub: '', paint: 'var(--bt-us-rest)', glyph: size => glyphBox(size, ChatsIcon) };
}
export function kindLabel(kind: string | undefined, botFocus: boolean): string | undefined {
    const labels: Record<string, string> = { chat: botFocus ? t('Own chat') : t('Conversations'), group: t('Group chats'), compaction: t('Compaction and handoff'), image: t('Image reading'), memory: t('Memory'), 'session-title': t('Titles'), other: t('Other') };
    return labels[kind ?? ''] ?? kind;
}
// Buttons on a track; a thumb slides to the chosen one.
export type TabOption = readonly [
    id: string,
    text: ReactNode,
    icon?: Glyph | undefined
];
export interface TabsProps {
    label: string;
    value: string;
    options: readonly TabOption[];
    onChange: (id: string) => void;
    boxRef?: RefObject<HTMLElement | null> | undefined;
}
export function Tabs({ label, value, options, onChange, boxRef }: TabsProps): ReactElement {
    const names = options.map(([, text]) => text).join('\n');
    const glide = useGlide(`${value}\n${names}`, { box: boxRef });
    return <div ref={glide.box as Ref<HTMLDivElement>} className='bt-us-tabs' role='group' aria-label={label}><span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden/>{options.map(([id, text, icon]) => <button key={id} type='button' aria-pressed={value === id} onClick={() => onChange(id)}>{icon ? h(icon) : null}{text}</button>)}</div>;
}
export interface StatsProps {
    range: PageRange;
    total: UsageSum;
    previous: number;
}
export function Stats({ range, total, previous }: StatsProps): ReactElement {
    const shown = useTween(total.total);
    const change = previous > 0 ? Math.round(((total.total - previous) / previous) * 100) : null;
    const cell = (label: ReactNode, value: ReactNode): ReactElement => <div className='bt-us-stat'><span className='bt-us-stat-label'>{label}</span><span className='bt-us-stat-value'>{value}</span></div>;
    return <section className='bt-us-stats' style={{ '--i': 0 }}><div className='bt-us-stat bt-us-stat-main'><span className='bt-us-stat-label'>{lastText(range)}</span><span className='bt-us-stat-value'>{compact(shown)}<small>{t('tokens')}</small>{change === null ? null : <span className='bt-us-delta' title={compareText(range)}>{`${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}%`}</span>}</span></div>{cell(t('Cache hit rate'), `${hitRate(total)}%`)}{cell(t('Output'), compact(total.output))}{cell(t('Calls'), full(total.calls))}</section>;
}
export function niceTop(max: number): number {
    if (!(max > 0))
        return 1;
    const step = 10 ** Math.floor(Math.log10(max));
    return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(scale => scale * step).find(value => value >= max) ?? 10 * step;
}
