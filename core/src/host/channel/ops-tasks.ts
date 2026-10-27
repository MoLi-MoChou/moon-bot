// The task panel's channel half (2026-10-28 tasks-panel): read what is running and what
// finished lately, and stop one turn. The data and the cancel live in host/tasks-panel;
// this only carries them over the api/bot channel.
import type { ChannelHandler, ChannelHandlers } from './envelope.ts'
import { fail, ok } from './envelope.ts'
import type { ChannelRuntime } from '../channel.ts'

interface TaskEntry {
  readonly sessionId: string
  readonly botId: string
  readonly botName: string
  readonly since?: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly reason?: string
  readonly roomId?: string
  readonly roomName?: string
  readonly tool?: string
  readonly target?: string
  readonly said?: string
  readonly switching?: boolean
  readonly fromName?: string
}

interface TasksReader {
  tasksView?(): { readonly running: readonly TaskEntry[], readonly completed: readonly TaskEntry[], readonly waiting: readonly { readonly botId: string, readonly botName: string, readonly for: readonly string[] }[] }
  stopTask?(sessionId: string): Promise<boolean>
}

export function taskHandlers(rt: ChannelRuntime): ChannelHandlers {
  const reader = rt as unknown as TasksReader
  const handlers: Partial<Record<string, ChannelHandler>> = {
    tasks: async () => {
      await rt.load()
      const view = reader.tasksView?.()
      return ok({
        running: view?.running ?? [],
        completed: view?.completed ?? [],
        waiting: view?.waiting ?? [],
      })
    },
    'task-stop': async (body) => {
      const sessionId = String(body.sessionId ?? '')
      if (sessionId === '') return fail('No turn named', 'bot/invalid')
      const stopped = await reader.stopTask?.(sessionId) ?? false
      return ok({ stopped })
    },
  }
  return handlers as ChannelHandlers
}
