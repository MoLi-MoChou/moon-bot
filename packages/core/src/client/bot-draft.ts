// Plain helpers for the Create Bot form, kept free of React so tests can load them.
import type { Bot } from 'moon-bot-contracts'

export interface DraftRoster {
  bots: Pick<Bot, 'name'>[]
  models?: readonly { ref: string }[]
  defaultModel?: string | null
}

export interface BotDraft {
  name: string
  look: { color: string; shape: string }
  image?: string | undefined
  model?: string | undefined
  effort?: string | undefined
  brief?: string | undefined
}

export function freshBotName(roster: DraftRoster, base = 'New Bot'): string {
  const taken = new Set(roster.bots.map(bot => bot.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let index = 2
  while (taken.has(`${base.toLowerCase()} ${index}`)) index += 1
  return `${base} ${index}`
}

// The form starts on the host default model when it is served, else the first one.
export function startModel(roster: DraftRoster): string {
  const models = roster.models ?? []
  return (models.find(model => model.ref === roster.defaultModel) ?? models[0])?.ref ?? ''
}

// The model is always sent: the host fixes it on the Bot at creation.
export function createPayload({ name, look, image, model, effort, brief }: BotDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = { name, color: look.color, avatar: image !== undefined ? { shape: look.shape, image } : { shape: look.shape } }
  if (model) payload.model = model
  if (effort) payload.effort = effort
  if (brief) payload.brief = brief
  return payload
}
