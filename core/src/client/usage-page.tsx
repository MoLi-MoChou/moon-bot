import { createElement as h, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { MAIN_LOOK } from './characters.ts';
import { BotMark } from './mark.tsx';
import { CalendarIcon } from './icons.tsx';
import { EmptyState } from './empty-state.tsx';
import { t } from './i18n.ts';
import { HOUR, MODEL, OWNER, RANGES, hourMs, spanRange, summarize, tokensOf } from './usage-data.ts';
import type { UsageRow, UsageSum, UsageSummary } from './usage-data.ts';
import type { UsageActions, UsageFocus, UsagePageView, UsageRoster, PageRange } from './usage-page-types.ts';
import { TOP_SERIES } from './usage-page-types.ts';
import { MODEL_INKS, PARTS, ModelGlyph, Stats, Tabs, kindLabel, ownerFace, partLabel, rangeLabel, soften, spanText, tickOf, titleOf, } from './usage-helpers.tsx';
import type { Face, TabOption } from './usage-helpers.tsx';
import { Chart, Heat, ListCard, Profile, Row, Skeleton, SpanPicker, monthOf, addMonths, } from './usage-charts.tsx';
import type { ChartColumn, ChartSeries, Span, StackPart } from './usage-charts.tsx';
export const focusOf = (id: string | null | undefined): UsageFocus | null => (id === null || id === undefined ? null
    : id.startsWith('model:') ? { kind: 'model', key: id.slice('model:'.length) }
        : id.startsWith('owner:') ? { kind: 'owner', key: id.slice('owner:'.length) }
            : null);
export interface Series {
    readonly key: string;
    readonly name: string | undefined;
    readonly paint?: string | undefined;
    fill?: string | undefined;
    readonly pick?: UsageFocus | undefined;
}
export type PaintedSeries = Series & {
    paint: string;
};
export interface Shaped {
    faces: Face[];
    models: Face[];
    ownerAt: number;
    modelAt: number;
    face: Face | null;
    keep: (row: UsageRow) => boolean;
    all: UsageSummary;
    part: UsageSummary;
    series: Series[];
    tipSeries: ChartSeries[];
    fillOf: Map<string, string | undefined>;
    columns: ChartColumn[];
    ranked: (map: Map<string, UsageSum>) => [
        string,
        UsageSum
    ][];
    isBot: (at: string | number) => boolean;
    activeDays: Set<string>;
    oldest: number;
}
export interface UsagePageProps {
    roster: UsageRoster;
    actions: UsageActions;
    focusId?: string | null;
}
export function UsagePage({ roster, actions, focusId }: UsagePageProps): ReactElement | null {
    const [view, setView] = useState<UsagePageView | null>(null);
    const [error, setError] = useState('');
    const [rangeId, setRangeId] = useState('7d');
    const [span, setSpan] = useState<Span | null>(null);
    const [picking, setPicking] = useState(false);
    const [by, setBy] = useState('bot');
    const tabs = useRef<HTMLDivElement | null>(null);
    const focus = focusOf(focusId);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = async (): Promise<void> => {
            try {
                const value = await actions.usage();
                if (stopped)
                    return;
                // A large render: as a transition it yields to the browser while it runs.
                startTransition(() => setView(value));
                setError('');
                // While older chats are still being read, totals catch up quickly.
                timer = setTimeout(load, value.scanning ? 3000 : 20000);
            }
            catch (failure) {
                if (stopped)
                    return;
                setError((failure as {
                    message?: string;
                } | null)?.message ?? String(failure));
                timer = setTimeout(load, 10000);
            }
        };
        void load();
        return () => { stopped = true; clearTimeout(timer); };
    }, []);
    const today = view?.now.slice(0, 10) ?? '';
    const range: PageRange = rangeId === 'custom' && span
        ? { ...spanRange(span.from, span.to), ends: span.to >= today }
        : RANGES.find(item => item.id === rangeId)!;
    const shaped = useMemo<Shaped | null>(() => {
        if (!view)
            return null;
        const faces = view.owners.map(owner => ownerFace(owner, roster));
        // A model keeps its color in every range: colors go by all-time tokens.
        const lifetime = new Map<string | number, number>();
        for (const row of view.rows)
            lifetime.set(row[MODEL], (lifetime.get(row[MODEL]) ?? 0) + tokensOf(row));
        const modelPaint = new Map<string | number, string>([...lifetime].sort((a, b) => b[1] - a[1]).map(([model], rank): [
            string | number,
            string
        ] => [model, `var(--bt-ink-${MODEL_INKS[rank % MODEL_INKS.length]})`]));
        const models = view.models.map((model, at): Face => {
            const name = model.name || model.model || t('Unknown model');
            const paint = modelPaint.get(at) ?? 'var(--bt-us-rest)';
            return { kind: 'model', name, sub: model.providerName ?? model.provider, paint, glyph: size => <ModelGlyph name={name} paint={paint} size={size} /> };
        });
        const ownerAt = focus?.kind === 'owner' ? view.owners.findIndex(owner => owner.key === focus.key) : -1;
        const modelAt = focus?.kind === 'model' ? view.models.findIndex(model => model.key === focus.key) : -1;
        // The DSH Agent stacks with the Bots; only rooms and outside sessions lump into the rest.
        const isBot = (at: string | number): boolean => ['bot', 'agent'].includes(view.owners[Number(at)]?.kind ?? '');
        const all = summarize(view, range, undefined, row => (by === 'bot' ? (isBot(row[OWNER]) ? `o${row[OWNER]}` : 'rest') : `m${row[MODEL]}`));
        const keep: (row: UsageRow) => boolean = ownerAt >= 0 ? row => Number(row[OWNER]) === ownerAt : modelAt >= 0 ? row => Number(row[MODEL]) === modelAt : () => true;
        const face: Face | null = ownerAt >= 0 ? faces[ownerAt] ?? null : modelAt >= 0 ? models[modelAt] ?? null : null;
        const part = face ? summarize(view, range, keep) : all;
        // The calendar dots the days with usage and opens back to the first of them, or a year.
        const activeDays = new Set<string>();
        let first = view.now;
        for (const row of view.rows) {
            if (row[HOUR] < first)
                first = row[HOUR];
            if (keep(row) && tokensOf(row) > 0)
                activeDays.add(row[HOUR].slice(0, 10));
        }
        const oldest = Math.min(monthOf(hourMs(first)), addMonths(monthOf(hourMs(view.now)), -12));
        const ranked = (map: Map<string, UsageSum>): [
            string,
            UsageSum
        ][] => [...map].filter(([, sum]) => sum.total > 0).sort((a, b) => b[1].total - a[1].total);
        // One Bot or model draws solid bars in its color; the token kinds show on hover.
        let series: Series[];
        if (face) {
            series = [{ key: 'all', name: face.name, fill: soften(face.paint) }];
        }
        else {
            let painted: PaintedSeries[];
            if (by === 'bot') {
                const bots = ranked(all.owners).filter(([at]) => isBot(at));
                painted = bots.slice(0, TOP_SERIES).map(([at]): PaintedSeries => {
                    const entry = faces[Number(at)]!;
                    return { key: `o${at}`, name: entry.name, paint: entry.paint, pick: { kind: 'owner', key: view.owners[Number(at)]!.key } };
                });
                if (bots.length > TOP_SERIES)
                    painted.push({ key: 'more', name: t('More Bots'), paint: 'var(--bt-us-more)' });
                if (ranked(all.owners).some(([at]) => !isBot(at)))
                    painted.push({ key: 'rest', name: t('Other'), paint: 'var(--bt-us-rest)' });
            }
            else {
                const used = ranked(all.models);
                painted = used.slice(0, TOP_SERIES).map(([at]): PaintedSeries => {
                    const entry = models[Number(at)]!;
                    return { key: `m${at}`, name: entry.name, paint: entry.paint, pick: { kind: 'model', key: view.models[Number(at)]!.key } };
                });
                if (used.length > TOP_SERIES)
                    painted.push({ key: 'more', name: t('More models'), paint: 'var(--bt-us-more)' });
            }
            // Bots or models that share a color stay apart: each repeat is lighter.
            const repeats = new Map<string, number>();
            for (const entry of painted) {
                const seen = repeats.get(entry.paint) ?? 0;
                repeats.set(entry.paint, seen + 1);
                entry.fill = soften(entry.paint, [1, 0.6, 0.36][seen % 3]);
            }
            series = painted;
        }
        const tipSeries: ChartSeries[] = face ? PARTS.map(([key, strength]) => ({ key, name: partLabel(key), fill: soften(face.paint, strength) })) : series;
        const fillOf = new Map(series.map((entry): [
            string,
            string | undefined
        ] => [entry.key, entry.fill]));
        const shownKeys = new Set(series.map(entry => entry.key));
        const columns: ChartColumn[] = part.buckets.map((bucket) => {
            const parts: StackPart[] = face
                ? [['all', bucket.sum.total]]
                : series.map((entry): StackPart => [entry.key, entry.key === 'more'
                        ? [...bucket.stacks].filter(([key]) => key !== 'rest' && !shownKeys.has(key)).reduce((sum, [, value]) => sum + value, 0)
                        : bucket.stacks.get(entry.key) ?? 0]);
            const tip: StackPart[] = face ? PARTS.map(([key]): StackPart => [key, bucket.sum[key]]) : parts;
            return { key: bucket.key, tick: tickOf(range, bucket), title: titleOf(range, bucket), total: bucket.sum.total, parts, tip };
        });
        return { faces, models, ownerAt, modelAt, face, keep, all, part, series, tipSeries, fillOf, columns, ranked, isBot, activeDays, oldest };
    }, [view, rangeId, span, by, focusId, roster]);
    // A Bot or model opens at the top of its page, and so does the way back.
    const root = useRef<HTMLDivElement | null>(null);
    useEffect(() => { root.current?.closest<HTMLElement>('.bt-settings-scroll')?.scrollTo?.({ top: 0 }); }, [focusId]);
    if (!view) {
        return error ? <div className='bt-error' role='alert' style={{ padding: 0 }}>{error}</div> : <Skeleton />;
    }
    if (view.rows.length === 0) {
        return <div className='bt-us'><EmptyState art={<BotMark look={MAIN_LOOK} size={56} live />} title={view.scanning ? t('Reading your chats…') : t('No usage yet.')} hint={t('Token usage shows up here after a model is called.')} /></div>;
    }
    if (!shaped)
        return null;
    const { faces, models, ownerAt, face, keep, all, part, series, tipSeries, fillOf, columns, ranked, isBot, activeDays, oldest } = shaped;
    const pick = (next: UsageFocus): void => actions.openSettings('usage', `${next.kind}:${next.key}`);
    const chooseRange = (id: string): void => {
        if (id !== 'custom') {
            setRangeId(id);
            setPicking(false);
            return;
        }
        if (span)
            setRangeId('custom');
        setPicking(open => !open);
    };
    const pickSpan = (from: string, to: string): void => {
        setSpan({ from, to });
        setRangeId('custom');
        setPicking(false);
    };
    const rangeOptions: TabOption[] = [
        ...RANGES.map((item): TabOption => [item.id, rangeLabel(item.id)]),
        ['custom', rangeId === 'custom' && span ? spanText(span.from, span.to) : t('Custom'), CalendarIcon],
    ];
    const whole = part.total.total;
    const ownerRow = ([at, sum]: readonly [
        string,
        UsageSum
    ], index: number, total = whole): ReactElement => {
        const entry = faces[Number(at)]!;
        return <Row key={`o${at}`} kind={entry.kind} glyph={entry.glyph(32)} name={entry.name} sub={entry.sub} sum={sum} whole={total} index={index} fill={face ? soften(face.paint, 0.8) : fillOf.get(`o${at}`) ?? soften(entry.paint)} onClick={() => pick({ kind: 'owner', key: view.owners[Number(at)]!.key })} />;
    };
    const modelRow = ([at, sum]: readonly [
        string,
        UsageSum
    ], index: number): ReactElement => {
        const entry = models[Number(at)]!;
        return <Row key={`m${at}`} kind='model' glyph={entry.glyph(32)} name={entry.name} sub={entry.sub} sum={sum} whole={whole} index={index} fill={face ? soften(face.paint, 0.8) : fillOf.get(`m${at}`) ?? soften(entry.paint)} onClick={() => pick({ kind: 'model', key: view.models[Number(at)]!.key })} />;
    };
    const nothing = <div className='bt-us-none'>{t('Nothing in this range.')}</div>;
    let body: ReactElement[];
    if (face) {
        const kinds = ranked(part.kinds);
        const usedModels = ranked(part.models);
        const owners = ranked(part.owners);
        body = [
            <Profile key='profile' face={face} range={range} share={all.total.total > 0 ? whole / all.total.total : 0} />,
            <div key='sheet' className='bt-us-sheet'><Stats key='stats' range={range} total={part.total} previous={part.previous} /><Chart key='chart' range={range} columns={columns} series={series} tipSeries={tipSeries} onPick={pick} /><div key='pair' className='bt-us-pair'>{ownerAt >= 0
                ? <ListCard title={t('Models')} count={usedModels.length} index={2}>{usedModels.length > 0 ? usedModels.map(modelRow) : nothing}</ListCard>
                : <ListCard title={t('Who used it')} count={owners.length} index={2}>{owners.length > 0 ? owners.map((entry, index) => ownerRow(entry, index)) : nothing}</ListCard>}<ListCard title={t('What for')} index={3}>{kinds.length > 0
                ? kinds.map(([at, sum], index) => <Row key={at} name={kindLabel(view.kinds[Number(at)], ownerAt >= 0 && isBot(ownerAt))} sum={sum} whole={whole} index={index} fill={soften(face.paint, 0.8)} />)
                : nothing}</ListCard></div><Heat key='heat' view={view} keep={keep} paint={face.paint} index={4} /></div>,
        ];
    }
    else {
        const owners = ranked(all.owners);
        const bots = owners.filter(([at]) => isBot(at));
        const rest = owners.filter(([at]) => !isBot(at));
        const usedModels = ranked(all.models);
        body = [
            <div key='sheet' className='bt-us-sheet'><Stats key='stats' range={range} total={all.total} previous={all.previous} /><Chart key='chart' range={range} columns={columns} series={series} tipSeries={tipSeries} by={by} onBy={setBy} onPick={pick} /><div key='pair' className='bt-us-pair'><ListCard title={t('Bots')} count={bots.length} index={2}>{owners.length > 0 ? null : nothing}{bots.map((entry, index) => ownerRow(entry, index))}{bots.length > 0 && rest.length > 0 ? <div className='bt-us-split' role='separator'/> : null}{rest.map((entry, index) => ownerRow(entry, bots.length + index))}</ListCard><ListCard title={t('Models')} count={usedModels.length} index={3}>{usedModels.length > 0 ? usedModels.map(modelRow) : nothing}</ListCard></div><Heat key='heat' view={view} keep={keep} paint='var(--bt-accent)' index={4} /></div>,
        ];
    }
    return <div ref={root} className='bt-us' key={focusId ?? 'all'}><div className='bt-us-top'><Tabs label={t('Time range')} value={rangeId} onChange={chooseRange} options={rangeOptions} boxRef={tabs} />{view.scanning ? <span className='bt-us-note' role='status'>{t('Still reading older chats; totals may grow.')}</span> : null}{picking ? <SpanPicker span={span} today={today} oldest={oldest} active={activeDays} near={tabs} onPick={pickSpan} onClose={() => setPicking(false)} /> : null}</div>{error ? <div className='bt-error' role='alert' style={{ padding: 0 }}>{error}</div> : null}{body}</div>;
}
