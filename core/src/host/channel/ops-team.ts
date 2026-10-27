// The team half of the channel: the state view and its live figures, conversations,
// files, and every endpoint that changes Bots, groups or the team's Agents.
import { COLORS, EXTRA_COLORS } from '../constants.ts'
import type { AttachmentRef } from '../dsh-types.ts'
import type { RpcEndpoint } from '../../shared/rpc.ts'
import type {
  BotRow,
  ChannelBody,
  ChannelHandler,
  ChannelHandlers,
  MessageText,
  RoomRow,
  SessionProjectionsService,
  TeamLive,
  TeamView,
} from './envelope.ts'
import type { ChannelRuntime } from '../channel.ts'
import { fail, invalid, ok, recordOf } from './envelope.ts'

const EMPTY: Readonly<Record<string, unknown>> = {}

const RUN_STATS = ['sessionStats', 'tokenUsage', 'contextPressure'] as const

interface RoomLine {
  readonly text: string
  readonly seq: number
  readonly kind?: string
  readonly who?: string
}

/** The interface language of the last browser that asked for the team. */
export interface LocaleState {
  value: string | undefined
}

// Models come from DSH, not state.json, so a provider added in Harness settings
// changes the view without a new revision.
const modelsKeyOf = (rt: ChannelRuntime): string => `${rt.cachedCatalog().map(entry => `${entry.ref}${entry.needsKey ? '!' : ''}${entry.reasoning ? `:${JSON.stringify(entry.reasoning)}` : ''}`).join(',')}|${rt.cachedDefault() ?? ''}`

/** The state view: what changes only with a new revision. */
function createView(rt: ChannelRuntime): () => TeamView {
  const { state } = rt
  return () => ({
    revision: state.revision,
    workspaceId: state.workspaceId ?? null,
    // `mainBotId` is the first Main Bot, which the sidebar shows as its tile.
    mainBotId: state.mainBotIds[0] ?? null,
    mainBotIds: state.mainBotIds,
    // `sessionId` is the Bot's current own-chat part; `parts` its earlier ones.
    // `waiting`: the Bot holds its greeting until the user picks its model.
    bots: Object.values(state.bots).map(({ segments, kickoff, ...bot }): BotRow => ({
      ...bot,
      sessionId: rt.chatOf(bot.id),
      parts: (segments ?? []).map(segment => segment.sessionId),
      ...(kickoff ? { waiting: true } : {}),
    })),
    // `parts`: the members' hidden group Sessions and their earlier segments, for usage.
    rooms: Object.values(state.rooms).map(({ log, seen, lateRounds, sessions, segments, ...room }): RoomRow => {
      const parts = [...Object.values(sessions ?? {}), ...Object.values(segments ?? {}).flat().map(segment => segment.sessionId)]
      const lines = (log ?? []) as readonly RoomLine[]
      const last = lines.filter(line => line.kind === undefined).at(-1)
      return { ...room, parts, ...(last ? { preview: last.who === 'User' ? last.text : `${last.who}：${last.text}` } : {}) }
    }),
    exchangeTurns: state.exchangeTurns,
    questions: state.questions,
    views: state.views ?? EMPTY,
    // The team's DSH Agent (at most one): plain dsh Sessions, not Bots.
    agents: Object.values(state.agents),
    // Key names and who may use them; values never leave the host.
    secrets: rt.secretsView(),
    capabilities: rt.capabilityLibraryView(),
    secretRequests: (state.secretRequests ?? EMPTY) as Readonly<Record<string, unknown>>,
    colors: [...COLORS, ...EXTRA_COLORS],
    models: rt.cachedCatalog(),
    defaultModel: rt.cachedDefault() ?? null,
    permissions: rt.permissionCatalog?.() ?? null,
    modelsKey: modelsKeyOf(rt),
    prefs: state.prefs,
    // Whether a Desktop window should serve Bot browser reads (see browser.js).
    browser: rt.browserEnabled,
    // False when config.memory turns memory off: no Memory row or panel.
    memory: rt.memoryEnabled !== false,
    // Set while another instance host holds the team (store.js): why this one cannot change it.
    readOnly: rt.readOnly() ?? null,
  })
}

/** What changes without a new revision, sent with every state answer. */
function createLive(rt: ChannelRuntime): () => TeamLive {
  return () => ({
    activity: rt.activityView(),
    work: { bots: rt.workView(), rooms: rt.roomWorkView(), approvals: rt.approvalsView(), waiting: rt.waitingView?.() ?? {}, turns: rt.turnsView?.() ?? {} },
    memoryNews: rt.memoryNews(),
    memoryReviews: rt.memoryReviews(),
    connectors: rt.connectorsView(),
    capabilityStatuses: rt.capabilityStatusesView(),
  })
}

/** The preference setters, shared by `set-prefs`. */
function createSetPrefs(rt: ChannelRuntime): (body: ChannelBody) => Promise<unknown> {
  const { state } = rt
  return async (body) => {
    if (body.theme !== undefined) {
      if (typeof body.theme !== 'string' || !/^[a-z][\w-]{0,31}$/.test(body.theme)) throw invalid('Unknown theme')
      state.prefs.theme = body.theme
    }
    if (body.accent !== undefined) {
      if (body.accent === null || body.accent === '') delete state.prefs.accent
      else if (typeof body.accent === 'string' && /^#[0-9a-f]{6}$/i.test(body.accent)) state.prefs.accent = body.accent
      else throw invalid('Accent must be a #rrggbb color')
    }
    if (body.motion !== undefined) {
      if (body.motion === null || body.motion === 'normal') delete state.prefs.motion
      else if (body.motion === 'quiet' || body.motion === 'lively') state.prefs.motion = body.motion
      else throw invalid('Motion must be quiet, normal or lively')
    }
    return rt.save()
  }
}

/** The team view's own handlers. */
export function teamHandlers(rt: ChannelRuntime, locale: LocaleState): ChannelHandlers {
  const { state } = rt
  const view = createView(rt)
  const live = createLive(rt)
  const setPrefs = createSetPrefs(rt)
  const modelsKey = (): string => modelsKeyOf(rt)

  const handlers: Partial<Record<RpcEndpoint, ChannelHandler>> = {
    state: async (body) => {
      if (typeof body.locale === 'string' && /^[a-z]{2,3}(-[\w-]+)?$/i.test(body.locale)) locale.value = body.locale
      const readOnly = rt.readOnly()
      if (readOnly === undefined) await rt.bootstrap()
      await rt.catalog()
      await rt.loadSecrets()
      if (body.since === state.revision && (body.models === undefined || body.models === modelsKey())) return ok({ revision: state.revision, unchanged: true, ...live() })
      return ok({ ...view(), ...live() })
    },
    models: async () => {
      await rt.catalog({ fresh: true })
      return ok({ modelsKey: modelsKey() })
    },
    efforts: async (body) => ok(await rt.reasoningOf(String(body.ref ?? '')) ?? { efforts: [] }),
    engines: async () => {
      await rt.load()
      const catalog = rt.ctx.get<{ list(): readonly { id: string; label: string; command: string; args: readonly string[]; key: string; kind: string; path?: string; version?: string; reason?: string }[] }>('engineCatalog')
      const entries = new Map<string, Record<string, unknown>>([['builtin', { id: 'builtin', label: 'Moon Bot built-in', kind: 'builtin', selectable: true }]])
      for (const agent of catalog?.list() ?? []) {
        entries.set(agent.id, {
          id: agent.id, label: agent.label, kind: agent.kind, command: agent.command, args: agent.args, key: agent.key,
          selectable: agent.kind === 'acp', ...(agent.path === undefined ? {} : { path: agent.path }),
          ...(agent.version === undefined ? {} : { version: agent.version }), ...(agent.reason === undefined ? {} : { reason: agent.reason }),
        })
      }
      const of: Record<string, string> = {}
      for (const bot of Object.values(state.bots)) {
        const engine = bot.engine
        of[bot.id] = engine?.kind === 'acp' && typeof engine.key === 'string' ? engine.key : engine?.kind === 'acp' && typeof engine.command === 'string' ? engine.command : 'builtin'
      }
      return ok({ engines: [...entries.values()], of })
    },
    'engine-set': async (body) => {
      await rt.load()
      const botId = String(body.botId ?? '')
      const engineId = String(body.engine ?? '')
      const bot = rt.botOf(botId)
      if (bot === undefined) return fail('Unknown Bot', 'bot/not-found')
      if (engineId === 'builtin') {
        await rt.updateBot(botId, { engine: { kind: 'builtin' }, runtimeId: null })
      } else {
        const catalog = rt.ctx.get<{ list(): readonly { id: string; command: string; args: readonly string[]; key: string; kind: string }[] }>('engineCatalog')
        const source = catalog?.list().find(candidate => candidate.id === engineId && candidate.kind === 'acp')
        if (source === undefined) return fail('Unknown engine', 'bot/not-found')
        await rt.updateBot(botId, { engine: { kind: 'acp', command: source.command, args: source.args, key: source.key }, runtimeId: source.key })
      }
      const of: Record<string, string> = {}
      for (const candidate of Object.values(state.bots)) {
        if (candidate.engine?.kind === 'acp') of[candidate.id] = candidate.engine.key ?? candidate.engine.command ?? ''
        else of[candidate.id] = 'builtin'
      }
      return ok({ of })
    },
    // A Turn's exact thinking time, from the timed stream in its events; `ms`
    // omitted when the stream carries no reasoning records.
    thinking: async (body) => {
      const sessionId = String(body.sessionId ?? '')
      const turn = Number(body.turn)
      if (!Number.isFinite(turn) || rt.selfOf(sessionId) === undefined) return ok(null)
      await rt.load()
      const ms = await rt.thinkingOf(sessionId, turn)
      return ok(ms === undefined ? {} : { ms })
    },
    'duplicate-bot': async (body) => {
      await rt.load()
      return ok(await rt.duplicateBot(body.id))
    },
    'set-prefs': async (body) => {
      await rt.load()
      await setPrefs(body)
      return ok(state.prefs)
    },
    exchange: async (body) => {
      await rt.load()
      const pair = new Set<unknown>([body.a, body.b])
      return ok(state.exchanges.filter(entry => pair.has(entry.from) && pair.has(entry.to)))
    },
    'exchange-text': async (body) => {
      await rt.load()
      const entry = state.exchanges.find(item => item.id === body.id)
      if (entry === undefined) return fail('This message is no longer kept', 'bot/stale')
      return ok(await rt.exchangeText(entry))
    },
    // A long Bot post's file (attachLong), for the group chat's "Show all".
    'file-text': async (body) => {
      const file = recordOf(body.file)
      if (file === undefined || typeof file.attachmentId !== 'string') return fail('No file named', 'bot/invalid')
      const read: MessageText | undefined = await rt.fileText(body.file as AttachmentRef)
      return read === undefined ? fail('This file cannot be read here', 'bot/unavailable') : ok(read)
    },
    // Moon Bot: the workspace file panel's Download and its card for files it cannot preview.
    'workspace-download': async (body) => {
      await rt.load()
      return ok(await rt.workspaceDownload(body.path))
    },
    'workspace-describe': async (body) => {
      await rt.load()
      return ok(await rt.workspaceDescribe(body.path))
    },
    earlier: async (body) => {
      await rt.load()
      return ok(await rt.earlierPage(String(body.sessionId ?? ''), body.cursor ?? undefined))
    },
    chat: async (body) => {
      await rt.load()
      return ok(await rt.chatPage(String(body.botId ?? ''), body.cursor ?? undefined))
    },
    // DSH's own whole-log figures for the current part of a Bot's chat, the ones its
    // status bar shows; a window without that bar shows them in the Bot's details.
    'run-stats': async (body) => {
      await rt.load()
      const bot = rt.botOf(String(body.botId ?? ''))
      if (bot === undefined) return fail('Unknown Bot', 'bot/not-found')
      const projections = rt.ctx.get<SessionProjectionsService>('sessionProjections')
      if (projections === undefined) return ok(null)
      const agent = await rt.resolveAgent(rt.chatOf(bot.id))
      return ok(projections.snapshot(agent.session, RUN_STATS).values)
    },
    usage: async (body) => {
      await rt.load()
      return ok(await rt.usageView({ timeZone: typeof body.timeZone === 'string' ? body.timeZone.slice(0, 64) : undefined }))
    },
    'room-progress': async (body) => ok([...rt.roomProgress.entries()].filter(([, entry]) => entry.roomId === body.roomId).map(([callId, entry]) => ({ callId, replies: entry.replies, speaking: entry.speaking ?? null }))),
    'create-bot': async (body) => {
      await rt.bootstrap()
      return ok(await rt.createBot({ name: body.name, role: body.role, color: body.color, instructions: body.instructions, brief: body.brief, avatar: body.avatar, model: body.model, effort: body.effort, workDir: body.workDir, engine: body.engine, runtimeId: body.runtimeId }))
    },
    'update-bot': async (body) => {
      await rt.load()
      return ok(await rt.updateBot(body.id, body))
    },
    'delete-bot': async (body) => {
      await rt.load()
      await rt.deleteBot(body.id)
      return ok(view())
    },
    'set-main': async (body) => {
      await rt.load()
      await rt.setMain(body.id, body.main !== false, {
        primary: body.primary === true,
        replace: typeof body.replace === 'string' ? body.replace : undefined,
      })
      return ok(view())
    },
    'create-room': async (body) => {
      await rt.load()
      const room = await rt.createRoom({ members: Array.isArray(body.members) ? body.members : [], name: body.name, ...(typeof body.admin === 'string' ? { admin: body.admin } : {}) })
      if (body.greet === true) await rt.greetRoom(room.id).catch(error => rt.warn('ds-bot: greeting in %s failed: %s', room.name, error))
      return ok(room)
    },
    'update-room': async (body) => {
      await rt.load()
      const { room, changes } = await rt.updateRoom(body.id, {
        name: body.name,
        notice: body.notice,
        mode: body.mode,
        admin: body.admin,
        members: Array.isArray(body.members) ? body.members : undefined,
        add: Array.isArray(body.add) ? body.add : undefined,
        remove: Array.isArray(body.remove) ? body.remove : undefined,
        workDir: body.workDir,
        permission: body.permission,
      })
      return ok({ room: view().rooms.find(entry => entry.id === room.id), changes })
    },
    folders: async (body, signal) => {
      await rt.load()
      return ok(await rt.folderEndpoint('folders', body, signal))
    },
    'folder-pick': async (body, signal) => {
      await rt.load()
      return ok(await rt.folderEndpoint('folder-pick', body, signal))
    },
    'folder-list': async (body, signal) => {
      await rt.load()
      return ok(await rt.folderEndpoint('folder-list', body, signal))
    },
    'team-workspace': async (body) => {
      await rt.load()
      return ok({ team: await rt.setTeamWorkspace(String(body.path ?? '')) })
    },
    'add-agent': async () => {
      await rt.load()
      return ok(await rt.addAgent())
    },
    'agent-session': async (body) => {
      await rt.load()
      return ok({ sessionId: await rt.createAgentSession(body.agentId, body.workspaceId) })
    },
    'agent-adopt': async (body) => {
      await rt.load()
      return ok({ sessionId: await rt.adoptAgentSession(body.agentId, body.sessionId) })
    },
    'agent-archive': async (body) => {
      await rt.load()
      await rt.archiveAgentSession(body.agentId, body.sessionId)
      return ok(true)
    },
    'agent-rename': async (body) => {
      await rt.load()
      await rt.renameAgentSession(body.agentId, body.sessionId, body.title)
      return ok(true)
    },
    'remove-agent': async (body) => {
      await rt.load()
      await rt.removeAgent(body.agentId)
      return ok(view())
    },
    'set-flags': async (body) => {
      await rt.load()
      return ok(await rt.setFlags(body.id, body))
    },
    'delete-room': async (body) => {
      await rt.load()
      await rt.deleteRoom(body.id)
      return ok(view())
    },
  }
  return handlers
}
