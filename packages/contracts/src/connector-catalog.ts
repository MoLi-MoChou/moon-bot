// The connector catalog: the curated list of MCP services
// the Connectors page offers one-click install for.
import { DEV_CONNECTORS } from './catalog/dev.ts'
import { WEB_CONNECTORS } from './catalog/web.ts'
import { DOCS_CONNECTORS } from './catalog/docs.ts'
import { DATA_CONNECTORS } from './catalog/data.ts'
import { CLOUD_CONNECTORS } from './catalog/cloud.ts'
import { SOCIAL_CONNECTORS } from './catalog/social.ts'
import { INTEL_CONNECTORS } from './catalog/intel.ts'

export type ConnectorCategory = 'dev' | 'web' | 'docs' | 'data' | 'cloud' | 'social' | 'intel'

export interface ConnectorCatalogSecret {
  readonly name: string
  readonly label: string
  readonly url?: string
  readonly optional?: boolean
}

export interface ConnectorCatalogEntry {
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

export const CONNECTOR_CATEGORIES: readonly { readonly id: ConnectorCategory; readonly label: string }[] = [
  { id: 'dev', label: 'Development' },
  { id: 'web', label: 'Web & Search' },
  { id: 'docs', label: 'Docs & Productivity' },
  { id: 'data', label: 'Data & Storage' },
  { id: 'cloud', label: 'Cloud & DevOps' },
  { id: 'social', label: 'Social & Media' },
  { id: 'intel', label: 'AI & Reasoning' },
]

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  ...DEV_CONNECTORS,
  ...WEB_CONNECTORS,
  ...DOCS_CONNECTORS,
  ...DATA_CONNECTORS,
  ...CLOUD_CONNECTORS,
  ...SOCIAL_CONNECTORS,
  ...INTEL_CONNECTORS,
]

/** The secret references an entry's config uses, so the install flow knows what to write. */
export const secretRefsOf = (entry: ConnectorCatalogEntry): readonly string[] => {
  const refs: string[] = []
  const pattern = /\$(?:MOON_BOT|DSH)_SECRET_([A-Z][A-Z0-9_]*)/g
  for (const value of [
    ...Object.values(entry.env ?? {}),
    ...Object.values(entry.headers ?? {}),
    ...(entry.args ?? []),
    entry.url ?? '',
  ]) {
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
  ...(entry.command !== undefined ? { command: entry.command, args: [...(entry.args ?? [])] } : {}),
  ...(entry.env !== undefined ? { env: { ...entry.env } } : {}),
  ...(entry.url !== undefined ? { url: entry.url } : {}),
  ...(entry.headers !== undefined ? { headers: { ...entry.headers } } : {}),
})
