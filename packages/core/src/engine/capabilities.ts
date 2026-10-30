// What an engine can do, as far as the host is willing to rely on it. A missing or
// unknown engine is the strict reading: it does not pause for a person, and it does
// not report usage. Nothing here may turn an approval into an allow.
import { ruleOf } from './policy.ts'

export interface EngineCapabilities {
  /** The engine can pause a tool call until the user answers. */
  readonly gatesTools: boolean
  /** The engine reports token usage. A false value is "not measured", never zero spend. */
  readonly reportsUsage: boolean
  /** Turns one session runs at once. A higher claim is not honored. */
  readonly concurrentTurns: 1
}

export const BUILTIN_CAPABILITIES: EngineCapabilities = { gatesTools: true, reportsUsage: true, concurrentTurns: 1 }
export const ACP_CAPABILITIES: EngineCapabilities = { gatesTools: true, reportsUsage: false, concurrentTurns: 1 }

/** Unknown engines do not get the benefit of the doubt. */
export function capabilitiesFor(kind: string | undefined): EngineCapabilities {
  if (kind === 'builtin') return BUILTIN_CAPABILITIES
  if (kind === 'acp' || kind === 'acp-remote') return ACP_CAPABILITIES
  return { gatesTools: false, reportsUsage: false, concurrentTurns: 1 }
}

/**
 * Tools this engine may be offered. When it cannot pause for approval, L3, L4 and
 * tools that ask on their own stay off the list. The policy still decides every call
 * that remains; this function never allows one.
 */
export function offeredTools(names: readonly string[], capabilities: EngineCapabilities): readonly string[] {
  if (capabilities.gatesTools) return names
  return names.filter(name => {
    const rule = ruleOf(name)
    return rule.level <= 2 && rule.asksItself !== true
  })
}
