// The team's data contract, shared by the host (which writes state.json) and the client
// (which reads the team view). Zod gives one definition, so a renamed field fails to
// compile on both sides instead of silently reading `undefined`.
//
// Phase 1 declares the contract; the running host still stores plain JS objects. The
// schemas are the reference the Phase 4 host migration must conform to.
import { z } from 'zod'

const id = z.string().min(1)
const name = z.string().min(1)
const time = z.number().int().nonnegative()
const color = z.string().regex(/^[a-z][\w-]{0,31}$/)

/** A Bot's stored look; either a built-in character or an uploaded image. */
export const AvatarSchema = z.object({
  shape: z.string().regex(/^[a-z][\w-]{0,31}$/).optional(),
  image: z.string().startsWith('data:image/').optional(),
})
export type Avatar = z.infer<typeof AvatarSchema>

/** One part of a conversation: the Session, and why the conversation moved on. */
export const SegmentSchema = z.object({
  sessionId: id,
  endedAt: time.optional(),
  fallback: z.string().optional(),
  note: z.string().optional(),
  noteFrom: z.number().int().optional(),
})
export type Segment = z.infer<typeof SegmentSchema>

export const BotSchema = z.object({
  id,
  name,
  role: z.string().default(''),
  color: color.optional(),
  avatar: AvatarSchema.optional(),
  model: z.string().optional(),
  appliedModel: z.string().optional(),
  effort: z.string().optional(),
  instructions: z.string().default(''),
  createdAt: time,
  createdBy: id.nullable().default(null),
  capabilities: z.array(z.string()).default([]),
  /** An explicit folder from the advanced settings; the app keeps its own otherwise. */
  workDir: z.string().optional(),
  /** The name of the folder the app keeps for this Bot. */
  folder: z.string().optional(),
  permission: z.string().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  segments: z.array(SegmentSchema).default([]),
  kickoff: z.object({ text: z.string(), from: id.nullable(), main: z.boolean().optional() }).optional(),
  copyOf: id.optional(),
})
export type Bot = z.infer<typeof BotSchema>

export const RoomSchema = z.object({
  id,
  name,
  named: z.boolean().optional(),
  members: z.array(id),
  admin: id.nullable(),
  mode: z.enum(['everyone', 'admin']),
  notice: z.string().default(''),
  createdAt: time,
  createdBy: id.nullable().default(null),
  workDir: z.string().optional(),
  folder: z.string().optional(),
  permission: z.string().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  /** Set when the group is archived. Absent means it is not. */
  archivedAt: z.number().optional(),
  /** Each member's hidden group Session, and its earlier parts. */
  sessions: z.record(id, id).optional(),
  segments: z.record(id, z.array(SegmentSchema)).optional(),
})
export type Room = z.infer<typeof RoomSchema>

/** One message between Bots: what the exchange dialog and the work handoff read. */
export const ExchangeTurnSchema = z.object({
  id,
  from: id,
  to: id,
  text: z.string(),
  role: z.enum(['request', 'reply', 'stopped', 'report', 'room', 'handoff']),
  time,
  replyTo: id.optional(),
  audience: z.literal('user').optional(),
  /** Set when the whole text lives in a host file instead of state.json. */
  length: z.number().int().positive().optional(),
  files: z.array(z.record(z.string(), z.unknown())).optional(),
})
export type ExchangeTurn = z.infer<typeof ExchangeTurnSchema>

/** One file a turn produced, as a chat card reads it. */
export const ProducedFileSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1),
})
export type ProducedFile = z.infer<typeof ProducedFileSchema>

export const TurnFilesSchema = z.object({
  produced: z.array(ProducedFileSchema),
  more: z.number().int().positive().optional(),
})
export type TurnFiles = z.infer<typeof TurnFilesSchema>

/** The memory panel's view of one entry. */
export const MemoryEntrySchema = z.object({
  scope: z.string(),
  topic: z.string().nullable(),
  text: z.string(),
  added: z.string().nullable(),
  by: z.string().nullable(),
  source: z.string().nullable(),
})
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

export const MemoryLimitsSchema = z.object({
  entry: z.number().int().positive(),
  main: z.number().int().positive(),
  topic: z.number().int().positive(),
  topics: z.number().int().positive(),
})
export type MemoryLimits = z.infer<typeof MemoryLimitsSchema>

/** A scheduled task as the settings page lists it. */
export const ScheduleTaskSchema = z.object({
  id,
  sessionId: id,
  title: z.string(),
  prompt: z.string(),
  kind: z.enum(['at', 'after', 'every', 'daily', 'weekly', 'cron']),
  botId: id.optional(),
  roomId: id.optional(),
  scheduledAt: z.string().optional(),
  everySeconds: z.number().int().positive().optional(),
  time: z.string().optional(),
  timeZone: z.string().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  expression: z.string().optional(),
  nextAt: z.string().optional(),
})
export type ScheduleTask = z.infer<typeof ScheduleTaskSchema>

export const SchedulesViewSchema = z.object({
  available: z.boolean(),
  tasks: z.array(ScheduleTaskSchema),
})
export type SchedulesView = z.infer<typeof SchedulesViewSchema>

/** A skill package a Bot may carry (Phase 3 wires it up; the contract exists now). */
export const BotSkillSchema = z.object({
  id,
  name,
  description: z.string().default(''),
  /** `mcp` servers, `skill` instruction packs, or a pack of both. */
  kind: z.enum(['mcp', 'skill', 'pack']),
  items: z.array(z.string()).default([]),
  approved: z.boolean().default(false),
})
export type BotSkill = z.infer<typeof BotSkillSchema>

/** A Bot's working folder and its floor for what may be written there. */
export const BotWorkspaceSchema = z.object({
  botId: id,
  folder: z.string(),
  permission: z.string().optional(),
  skills: z.array(BotSkillSchema).default([]),
})
export type BotWorkspace = z.infer<typeof BotWorkspaceSchema>

/** `state`'s bot and room entries reach the browser without folders or paths. */
export const BotViewSchema = BotSchema.omit({ workDir: true, folder: true, segments: true }).extend({
  sessionId: id,
  parts: z.array(id),
  waiting: z.boolean().optional(),
})
export type BotView = z.infer<typeof BotViewSchema>

export const RoomViewSchema = RoomSchema.omit({ workDir: true, folder: true, sessions: true, segments: true }).extend({
  parts: z.array(id),
  preview: z.string().optional(),
})
export type RoomView = z.infer<typeof RoomViewSchema>
