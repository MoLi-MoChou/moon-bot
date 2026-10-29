// Standalone web_search for Bots (Researcher and the rest): the same auto provider the
// old the host web seam used — native search on the conversation's model route when one is
// known, else a keyless parse of public Bing / DuckDuckGo results. SenseNova and other
// custom routes have no native search; the fallback answers without changing model
// config. Wired into the host tool registry so the standalone service serves it.
import { z } from 'zod'
import type { ToolContext } from '../../engine/registry.ts'
import { createAutoSearchProvider, type WebPage } from '../../web-search/provider.ts'
import type { Source } from '../../web-search/source.ts'
import type { HostRuntime } from '../runtime.ts'
import type { ToolShared } from './shared.ts'

const USER_AGENT = 'moon-bot/0.1.0'

/** Fetches a public results page the way the old the host web.fetch seam did. */
async function webFetch(request: { readonly url: string }, signal?: AbortSignal): Promise<WebPage> {
  const init: RequestInit = {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.8',
    },
  }
  if (signal !== undefined) init.signal = signal
  const response = await fetch(request.url, init)
  const content = await response.text()
  return { statusCode: response.status, body: { content } }
}

const formatSources = (sources: readonly Source[]): string => {
  if (sources.length === 0) return '(no results)'
  return sources.map((source, index) => {
    const parts = [`${index + 1}. ${source.title || source.url}`, source.url]
    if (source.snippet) parts.push(source.snippet)
    return parts.join('\n')
  }).join('\n\n')
}

export function installWebSearchTool(_rt: HostRuntime, shared: ToolShared): void {
  // One provider per process: endpoint skip memory stays across calls the way the host
  // plugin kept it. route() is unset here — standalone has no the host session route — so
  // native search reports "no conversation model route" and the keyless fallback runs.
  const provider = createAutoSearchProvider({
    route: () => undefined,
    resolveKey: async () => undefined,
    fetch: (url, init) => fetch(url, init),
    webFetch,
  })

  shared.register({
    name: 'web_search',
    label: 'Web search',
    description: 'Search the public web. Prefer this over guessing URLs. Pass one or more short queries; results name which backend answered. When native search is unavailable for the model route, a keyless public results page is used.',
    parameters: {
      queries: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'One or more search queries; each is run in turn and the answers are joined',
      },
    },
    schema: z.object({
      queries: z.union([z.array(z.string()), z.string()]).optional(),
      query: z.string().optional(),
    }).passthrough(),
    async execute(args: { readonly queries?: unknown; readonly query?: unknown }, context: ToolContext) {
      const raw = args.queries ?? args.query
      const queries = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
        .map(item => String(item ?? '').trim())
        .filter(Boolean)
      if (queries.length === 0) {
        return { content: [{ type: 'text' as const, text: 'web_search needs at least one query.' }], isError: true }
      }
      const blocks: string[] = []
      for (const query of queries) {
        try {
          const result = await provider.search({ query }, context.signal)
          blocks.push([`## Query: ${query}`, result.content, '', formatSources(result.sources)].join('\n'))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          blocks.push([`## Query: ${query}`, message].join('\n'))
        }
      }
      return blocks.join('\n\n')
    },
  })
}
