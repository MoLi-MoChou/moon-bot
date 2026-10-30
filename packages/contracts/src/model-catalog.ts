// Model capability catalog and metadata matching. Inspired by yetone/magpie catalog
// and models.dev open specifications. Resolves context window, input modalities,
// and reasoning capabilities for standard and custom models.
import { MODEL_PRESETS, type ModelPreset } from './model-catalog-presets.ts'

export type Modality = 'text' | 'image' | 'audio'

export interface ModelCapability {
  readonly id: string
  readonly name?: string | undefined
  readonly contextWindow?: number | undefined
  readonly maxTokens?: number | undefined
  readonly inputModalities?: readonly Modality[] | undefined
  readonly reasoning?: boolean | undefined
  readonly reasoningEfforts?: readonly string[] | undefined
}

const dynamicSpecs = new Map<string, ModelCapability>()

export function registerDynamicModelSpec(spec: ModelCapability): void {
  dynamicSpecs.set(bareModelId(spec.id), spec)
}

export function clearDynamicModelSpecs(): void {
  dynamicSpecs.clear()
}

/** Formats token count to compact human-readable string (e.g. 128k, 200k, 1M, 2M). */
export function formatContextWindow(tokens: number | undefined): string {
  if (tokens === undefined || tokens <= 0) return ''
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const k = Math.round(tokens / 1_000)
    return `${k}k`
  }
  return String(tokens)
}

/** Strips vendor/provider prefix before slash (e.g. 'openai/gpt-4o' -> 'gpt-4o'). */
export function bareModelId(id: string): string {
  const clean = id.trim().toLowerCase()
  const idx = clean.lastIndexOf('/')
  return idx >= 0 ? clean.slice(idx + 1) : clean
}

/** Parses explicit context window mark in brackets (e.g. 'claude-opus-5[1m]' -> window: 1000000). */
export function parseWindowMark(id: string): { base: string; window?: number } {
  if (!id.endsWith(']')) return { base: id }
  const idx = id.lastIndexOf('[')
  if (idx <= 0) return { base: id }
  const mark = id
    .slice(idx + 1, -1)
    .trim()
    .toLowerCase()
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(mark)
  if (!match) return { base: id }
  const num = parseFloat(match[1] ?? '0')
  const unit = (match[2] ?? '').toLowerCase()
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1
  const window = Math.round(num * multiplier)
  return { base: id.slice(0, idx), ...(window > 0 ? { window } : {}) }
}

const BEDROCK_GEOS = ['global.', 'us.', 'us-gov.', 'eu.', 'apac.', 'jp.', 'au.', 'ca.', 'in.']

/** Strips suffixes like (high), :free, :thinking and Bedrock regional prefixes. */
export function stripModelDecorations(id: string): string {
  let clean = id
  for (const geo of BEDROCK_GEOS) {
    if (clean.startsWith(geo)) {
      clean = clean.slice(geo.length)
      break
    }
  }
  const paren = clean.indexOf('(')
  if (paren > 0 && clean.endsWith(')')) clean = clean.slice(0, paren)
  const colon = clean.indexOf(':')
  if (colon > 0) clean = clean.slice(0, colon)
  return clean
}

/** Normalizes dots to dashes (e.g. claude-3.7-sonnet -> claude-3-7-sonnet). */
export function normalizeDashes(id: string): string {
  return id.replace(/\./g, '-')
}

/** Strips date stamp suffix like -20241022 or -2024-08-06. */
function stripDateStamp(id: string): string {
  return id.replace(/-20\d{2}[-_]?\d{2}[-_]?\d{2}$/, '').replace(/-\d{4}$/, '')
}

const RELAY_PREFIXES = ['claude-', 'relay-', 'proxy-', 'openai-', 'anthropic-', 'custom-']

function presetToCapability(preset: ModelPreset, explicitWindow?: number): ModelCapability {
  const inputs: Modality[] = preset.vision ? ['text', 'image'] : ['text']
  return {
    id: preset.id,
    name: preset.name,
    contextWindow: explicitWindow ?? preset.context,
    maxTokens: preset.maxTokens,
    inputModalities: inputs,
    reasoning: preset.reasoning ?? false,
    reasoningEfforts: preset.reasoning ? ['low', 'medium', 'high'] : undefined,
  }
}

function findKnown(key: string): ModelPreset | undefined {
  const lower = key.toLowerCase()
  return MODEL_PRESETS.find(p => p.id === lower || normalizeDashes(p.id) === lower)
}

function inferCapabilities(id: string, explicitWindow?: number): ModelCapability {
  const lower = id.toLowerCase()
  let contextWindow = explicitWindow

  if (!contextWindow) {
    if (lower.includes('10m')) contextWindow = 10_000_000
    else if (lower.includes('2m') || lower.includes('2048k')) contextWindow = 2_097_152
    else if (lower.includes('1m') || lower.includes('1000k') || lower.includes('1024k')) contextWindow = 1_000_000
    else if (lower.includes('256k')) contextWindow = 256_000
    else if (lower.includes('200k')) contextWindow = 200_000
    else if (lower.includes('128k') || lower.includes('131k')) contextWindow = 128_000
    else if (lower.includes('64k') || lower.includes('65k')) contextWindow = 64_000
    else if (lower.includes('32k')) contextWindow = 32_768
    else if (lower.includes('16k')) contextWindow = 16_384
    else if (lower.includes('8k')) contextWindow = 8_192
    else if (lower.includes('4k')) contextWindow = 4_096
  }

  const isVision = /(vision|[-_]vl[-_]|[-_]vl$|4o|pixtral|omni|image|qvq|gemini)/i.test(lower)
  const isReasoning = /(reasoner|reasoning|[-_]r1|[-_]o1|[-_]o3|thinking|qwq|qvq|[-_]zero)/i.test(lower)
  const inputModalities: Modality[] = isVision ? ['text', 'image'] : ['text']

  return {
    id,
    contextWindow,
    inputModalities,
    reasoning: isReasoning,
    reasoningEfforts: isReasoning ? ['low', 'medium', 'high'] : undefined,
  }
}

/**
 * Resolves a model id to its capabilities (context window, input modalities, reasoning),
 * utilizing preset models, dynamic models.dev catalog, aliases, and smart heuristics.
 */
export function resolveModelSpec(id: string): ModelCapability {
  const raw = id.trim()
  if (!raw) return { id: raw }

  const { base, window: explicitWindow } = parseWindowMark(raw)
  const bare = bareModelId(base)

  const dynamic = dynamicSpecs.get(bare) ?? dynamicSpecs.get(bareModelId(raw))
  if (dynamic) {
    return explicitWindow !== undefined ? { ...dynamic, contextWindow: explicitWindow } : dynamic
  }

  const exact = findKnown(bare)
  if (exact) return presetToCapability(exact, explicitWindow)

  const stripped = stripModelDecorations(bare)
  const strippedMatch = findKnown(stripped)
  if (strippedMatch) return presetToCapability(strippedMatch, explicitWindow)

  const dashed = normalizeDashes(stripped)
  const dashedMatch = findKnown(dashed)
  if (dashedMatch) return presetToCapability(dashedMatch, explicitWindow)

  const dateStripped = stripDateStamp(dashed)
  const dateMatch = findKnown(dateStripped)
  if (dateMatch) return presetToCapability(dateMatch, explicitWindow)

  for (const prefix of RELAY_PREFIXES) {
    if (dashed.startsWith(prefix) && /\d/.test(dashed.slice(prefix.length))) {
      const rest = dashed.slice(prefix.length)
      const prefixMatch = findKnown(rest) || findKnown(stripDateStamp(rest))
      if (prefixMatch) return presetToCapability(prefixMatch, explicitWindow)
    }
  }

  return inferCapabilities(raw, explicitWindow)
}
