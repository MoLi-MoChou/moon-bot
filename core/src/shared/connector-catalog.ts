// The connector catalog (2026-10-27 connector-market): the curated list of MCP services
// the Connectors page offers one-click install for. It is data, not code — an entry says
// how the capability is mounted (stdio command or streamable-http URL) and which secrets
// it needs; the install flow writes those secrets and saves the capability item, and
// everything after that (approval, mounting, policy gating) is the capability system's
// unchanged work. Entries carry only endpoints verified against the official MCP registry
// or the vendor's own package; the list ships with the app and refreshes on release.
export type ConnectorCategory = 'dev' | 'web' | 'docs' | 'memory'

export interface ConnectorCatalogSecret {
  /** The secret's name in the secrets store; configs reference it as $MOON_BOT_SECRET_<name>. */
  readonly name: string
  readonly label: string
  /** Where the user gets the token. */
  readonly url?: string
  readonly optional?: boolean
}

export interface ConnectorCatalogEntry {
  /** The capability name; lowercase letters, digits, single dashes, at most 32. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: ConnectorCategory
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly secrets?: readonly ConnectorCatalogSecret[]
  readonly website?: string
}

export const CONNECTOR_CATEGORIES: readonly { readonly id: ConnectorCategory, readonly label: string }[] = [
  { id: 'dev', label: 'Development' },
  { id: 'web', label: 'Web' },
  { id: 'docs', label: 'Docs' },
  { id: 'memory', label: 'Memory' },
]

// Verified 2026-10-27 against the MCP registry (io.github.getsentry/sentry-mcp), the
// reference servers README, and the vendors' npm packages.
export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Errors, issues, releases and debugging for your projects.',
    category: 'dev',
    transport: 'streamable-http',
    url: 'https://mcp.sentry.dev/mcp',
    headers: { Authorization: 'Bearer $MOON_BOT_SECRET_SENTRY_ACCESS_TOKEN' },
    secrets: [{ name: 'SENTRY_ACCESS_TOKEN', label: 'Sentry access token', url: 'https://sentry.io/settings/auth-tokens/' }],
    website: 'https://sentry.io',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Drives a real browser: open pages, click, fill, and read what is there.',
    category: 'dev',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    website: 'https://playwright.dev',
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date documentation for libraries, fetched while the Bot works.',
    category: 'docs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: { CONTEXT7_API_KEY: '$MOON_BOT_SECRET_CONTEXT7_API_KEY' },
    secrets: [{ name: 'CONTEXT7_API_KEY', label: 'Context7 API key', url: 'https://context7.com/dashboard', optional: true }],
    website: 'https://context7.com',
  },
  {
    id: 'web-fetch',
    name: 'Fetch',
    description: 'Fetches web pages and turns them into text the model reads well.',
    category: 'web',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    website: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'knowledge-graph',
    name: 'Knowledge graph memory',
    description: 'A persistent graph of nodes and relations the team can write and query.',
    category: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    website: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential thinking',
    description: 'Structured step-by-step reasoning for problems that need it.',
    category: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequentialthinking'],
    website: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
]

/** The secret references an entry's config uses, so the install flow knows what to write. */
export const secretRefsOf = (entry: ConnectorCatalogEntry): readonly string[] => {
  const refs: string[] = []
  const pattern = /\$(?:MOON_BOT|DSH)_SECRET_([A-Z][A-Z0-9_]*)/g
  for (const value of [...Object.values(entry.env ?? {}), ...Object.values(entry.headers ?? {}), entry.url ?? '']) {
    for (const match of value.matchAll(pattern)) refs.push(match[1] as string)
  }
  return [...new Set(refs)]
}

/** The capability item an entry installs as — the same shape the Capabilities page saves. */
export const capabilityOf = (entry: ConnectorCatalogEntry): Record<string, unknown> => ({
  name: entry.id,
  kind: 'mcp',
  description: entry.description,
  transport: entry.transport,
  ...(entry.command !== undefined ? { command: entry.command, args: [...entry.args ?? []] } : {}),
  ...(entry.env !== undefined ? { env: { ...entry.env } } : {}),
  ...(entry.url !== undefined ? { url: entry.url } : {}),
  ...(entry.headers !== undefined ? { headers: { ...entry.headers } } : {}),
})
