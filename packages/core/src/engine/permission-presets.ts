// The permission presets a Bot or group keeps, and what they mean for the tool gate.
//
// The standalone product ships one sandbox: tools run in the workspace they were given,
// and the file layer refuses a path outside it. So a preset here narrows *what runs
// without asking* rather than switching a sandbox mode — the levels the policy engine
// already knows are the unit, and a preset decides how far up the ladder a call may go
// before the user is asked.
//
// Nothing in this file can widen a call: every preset maps to a ceiling, and the engine's
// policy still applies on top. `danger-full-access` is the one that lets L3 and L4 run
// inside their daily budgets; it is only ever set because the user picked it for that Bot
// or group, and every Bot without a preset keeps the default, which asks sooner.
export interface PresetOption {
  readonly value: string
  readonly name: string
  readonly description: string
}

/** A preset's ceiling: the highest risk level that runs without an approval. */
export type PresetCeiling = 0 | 1 | 2 | 3 | 4

export const PRESETS: readonly PresetOption[] = [
  {
    value: 'read-only',
    name: 'Read only',
    description: 'Reads its own chats, the team list and its memory. Anything that changes something asks.',
  },
  {
    value: 'workspace-write',
    name: 'Workspace',
    description:
      'Also writes in its own folders, messages other Bots and runs its tools within the daily budgets. Destructive calls ask.',
  },
  {
    value: 'danger-full-access',
    name: 'Full access',
    description: 'Runs every tool within the policy budgets. Irreversible calls still ask once a budget is spent.',
  },
]

/** Without a pick, a Bot gets this: it can work, and nothing irreversible runs unasked. */
export const DEFAULT_PRESET = 'workspace-write'

const CEILINGS: Readonly<Record<string, PresetCeiling>> = {
  // L0 reads only: a Bot that may not send a message either still answers the user,
  // because the turn's own reply is not a tool call.
  'read-only': 0,
  'workspace-write': 3,
  'danger-full-access': 4,
}

export const presetValues = (): readonly string[] => PRESETS.map(option => option.value)

export const hasPreset = (name: string): boolean => Object.hasOwn(CEILINGS, name)

/** The level a preset lets run unasked; an unknown preset is the default, never a pass. */
export const ceilingOf = (name: string | undefined): PresetCeiling => {
  // Not `||`: read-only's ceiling is 0, and a fallback on falsiness would raise it.
  if (name !== undefined && Object.hasOwn(CEILINGS, name)) return CEILINGS[name] as PresetCeiling
  return CEILINGS[DEFAULT_PRESET] as PresetCeiling
}

/**
 * What a preset does to one tool at one level, beside the policy engine's own answer.
 *
 * `within` means the preset does not change the outcome; `ask` means the call waits for
 * the user even though the daily budget would have let it run.
 */
export const gateOfPreset = (name: string | undefined, level: number): 'within' | 'ask' =>
  level <= ceilingOf(name) ? 'within' : 'ask'
