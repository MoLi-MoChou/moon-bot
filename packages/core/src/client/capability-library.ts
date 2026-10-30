// Reading the capability library without a browser: what a row says about its keys, its
// tools and its live connection, and how the page groups and searches the list.
import { CONNECTOR_CATALOG } from '../shared/connector-catalog.ts';
import type { Capability, CapabilityBot, CapabilityHealth, CapabilityHealthState, CapabilityStatus, KeyReadiness } from './capability-types.ts';

const SECRET_REFERENCE = /\$(?:MOON_BOT|DSH)_SECRET_([A-Z][A-Z0-9_]*)/g;
export const CAPABILITY_KINDS = ['mcp', 'skill', 'pack'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityFilterKind = CapabilityKind | 'all';

const stringsOf = (item: Capability): string[] => [
    item.url ?? '',
    ...(item.args ?? []),
    ...Object.values(item.env ?? {}),
    ...Object.values(item.headers ?? {}),
];

/** The saved keys an item's command, URL or headers refer to. */
export function secretNamesOf(item: Capability): string[] {
    const names = new Set<string>();
    for (const value of stringsOf(item)) {
        for (const match of value.matchAll(SECRET_REFERENCE))
            names.add(match[1] as string);
    }
    return [...names];
}

export function keyReadiness(item: Capability, secrets: readonly { name: string }[]): KeyReadiness {
    const saved = new Set(secrets.map(entry => entry.name));
    const names = secretNamesOf(item);
    return { total: names.length, missing: names.filter(name => !saved.has(name)) };
}

export function kindOf(item: Capability): CapabilityKind {
    return item.kind === 'skill' ? 'skill' : item.kind === 'pack' ? 'pack' : 'mcp';
}

/** Where the item came from: a member of the connector market, or one the user typed. */
export function sourceOf(item: Capability): 'market' | 'custom' {
    return CONNECTOR_CATALOG.some(entry => entry.id === item.name) ? 'market' : 'custom';
}

/** The tools the library reports for an item; a pack merges the tools of its child servers. */
export function toolsOf(item: Capability, tools: Readonly<Record<string, readonly string[]>> | undefined): readonly string[] {
    const map = tools ?? {};
    if (kindOf(item) !== 'pack')
        return map[item.name] ?? [];
    return [...new Set((item.items ?? []).flatMap(child => map[child] ?? []))];
}

/** The tools a pack's children serve that are not itself a pack; used for the detail text. */
export function serverNamesOf(item: Capability): readonly string[] {
    return item.items ?? [];
}

export function botsUsing(item: Capability, bots: readonly CapabilityBot[]): readonly CapabilityBot[] {
    return bots.filter(bot => (bot.capabilities ?? []).includes(item.name));
}

const order: readonly CapabilityHealthState[] = ['error', 'needs-approval', 'connecting', 'ready'];
const pick = (states: readonly CapabilityStatus[]): CapabilityStatus | undefined =>
    order.map(state => states.find(status => status.state === state)).find((status): status is CapabilityStatus => status !== undefined);

/** One state for a library item, folded from the live statuses of every Bot that runs it. */
export function healthOf(
    item: Capability,
    bots: readonly CapabilityBot[],
    statuses: Readonly<Record<string, Readonly<Record<string, CapabilityStatus | undefined>> | undefined>> | undefined,
): CapabilityHealth {
    const using = botsUsing(item, bots);
    if (using.length === 0)
        return { state: 'off', using };
    const live = using.flatMap(bot => {
        const status = statuses?.[bot.id]?.[item.name];
        return status === undefined ? [] : [{ bot, status }];
    });
    const status = pick(live.map(entry => entry.status));
    if (status === undefined)
        return { state: 'enabled', using };
    const owner = live.find(entry => entry.status.state === status.state)?.bot;
    return {
        state: status.state as CapabilityHealthState,
        ...(owner === undefined ? {} : { botName: owner.name }),
        ...(status.error === undefined ? {} : { error: status.error }),
        using,
    };
}

export interface CapabilityFilter {
    query: string;
    kind: CapabilityFilterKind;
    tools?: Readonly<Record<string, readonly string[]>> | undefined;
    /** Localized text the search also matches; the caller resolves it at render time. */
    textOf?: ((item: Capability) => string) | undefined;
}

export function matchesFilter(item: Capability, filter: CapabilityFilter): boolean {
    if (filter.kind !== 'all' && kindOf(item) !== filter.kind)
        return false;
    const query = filter.query.trim().toLowerCase();
    if (query === '')
        return true;
    const haystack = [
        item.name,
        item.description ?? '',
        kindOf(item),
        sourceOf(item),
        ...toolsOf(item, filter.tools),
        filter.textOf?.(item) ?? '',
    ].join(' ').toLowerCase();
    return haystack.includes(query);
}

export function filterCapabilities(items: readonly Capability[], filter: CapabilityFilter): Capability[] {
    return items.filter(item => matchesFilter(item, filter));
}

export interface CapabilityGroup {
    kind: CapabilityKind;
    items: Capability[];
}

/** Type groups in a fixed order; the market's items come before custom ones, then by name. */
export function groupCapabilities(items: readonly Capability[]): CapabilityGroup[] {
    const groups: CapabilityGroup[] = [];
    for (const kind of CAPABILITY_KINDS) {
        const group = items.filter(item => kindOf(item) === kind)
            .sort((a, b) => Number(sourceOf(b) === 'market') - Number(sourceOf(a) === 'market') || a.name.localeCompare(b.name));
        if (group.length > 0)
            groups.push({ kind, items: group });
    }
    return groups;
}

export function countsByKind(items: readonly Capability[]): Record<CapabilityFilterKind, number> {
    const counts: Record<CapabilityFilterKind, number> = { all: items.length, mcp: 0, skill: 0, pack: 0 };
    for (const item of items) counts[kindOf(item)] += 1;
    return counts;
}
