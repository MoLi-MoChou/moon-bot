// A new Bot's first message, and the photo it may carry: the greeting is what makes a
// fresh Bot introduce itself and ask where to start.
import { MAX_AVATAR_IMAGE } from './constants.ts'
import type { HostRuntime, StoredBot } from './runtime.js'

export function cleanAvatar(input: unknown): { shape?: string; image?: string } | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const source = input as { readonly shape?: unknown; readonly image?: unknown }
  const avatar: { shape?: string; image?: string } = {}
  if (typeof source.shape === 'string' && /^[a-z][\w-]{0,31}$/.test(source.shape)) avatar.shape = source.shape
  if (typeof source.image === 'string') {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source.image))
      throw new Error('Avatar images must be PNG, JPEG, WebP, or GIF')
    if (source.image.length > MAX_AVATAR_IMAGE) throw new Error('Avatar image is too large')
    avatar.image = source.image
  }
  return Object.keys(avatar).length > 0 ? avatar : undefined
}

interface KickoffInput {
  readonly main: boolean
  readonly originalName: string | undefined
  readonly creatorName: string | undefined
  readonly brief: string
  readonly language: string | undefined
}

// The kickoff arrives as a user message, so it outranks the Bot's instructions unless it
// gives way to them, and it names no tool those instructions may rule out.
export function kickoffText({ main, originalName, creatorName, brief, language }: KickoffInput): string {
  const kickoff = main
    ? `You were just set up as the user's Main Bot. Greet the user in one or two short messages: say you will run their Bot team and that they can come to you for anything that needs a decision. Then ask in one short question what they want the team to help with first. Write in ${language ?? "the user's language if known; otherwise Chinese"}.`
    : originalName !== undefined
      ? `The user just made you as a copy of ${originalName}: same job, fresh memory. Greet the user in one short message, then ask in one short question what this copy should focus on.`
      : creatorName !== undefined
        ? `${creatorName} just created you for the user.${brief ? ` Why you exist: ${brief}` : ''}\nGreet the user in one short message, then ask in one short question where to start. Keep it brief.`
        : brief
          ? `The user just created you and sent this first message:\n\n${brief}\n\nIntroduce yourself in one short line, then help with it.`
          : 'The user just created you. Greet the user in one short message, then ask in one short question what you should focus on.'
  const opener = `${kickoff}\nWhere your instructions say otherwise, follow them.`
  return !main && language ? `${opener}\nWrite in ${language}.` : opener
}

export function sendKickoff(
  rt: HostRuntime,
  bot: StoredBot,
  { text, from }: { readonly text: string; readonly from?: string },
): void {
  void rt
    .deliver({ ...(from === undefined ? {} : { fromId: from }), toId: bot.id, text, role: 'kickoff' })
    .catch(error => rt.warn('moon-bot: kickoff failed: %s', error))
}

// The user wrote first, so the held greeting would only interrupt.
export function dropKickoff(rt: HostRuntime, botId: string): void {
  const bot = rt.botOf(botId)
  if (bot?.kickoff === undefined) return
  delete bot.kickoff
  void rt.save().catch(() => {})
}
