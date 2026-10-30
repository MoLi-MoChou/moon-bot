import { freePriority } from './surface.ts'
import type { SlotEntryLike } from './surface.ts'

interface SlotFace {
  entries(name: string): readonly SlotEntryLike[]
  register(options: Record<string, unknown>, component: unknown): () => void
  subscribe(name: string, listener: () => void): () => void
}

const navigationEntry = (entries: readonly SlotEntryLike[]): SlotEntryLike | undefined => entries.find(entry => entry.store !== undefined && typeof entry.inject === 'function')

// Reuse the replaced header's public navigation face and store: activating a
// Conversation target alone does not change its persisted View selection.
export function headerNavigation(entries: readonly SlotEntryLike[], face: () => Record<string, unknown> & { hooks?: Record<string, unknown> }): Record<string, unknown> {
  const source = navigationEntry(entries)
  return {
    ...(source !== undefined ? { store: source.store } : {}),
    inject: (...args: readonly unknown[]) => {
      const navigation = (source?.inject?.(...args) ?? {}) as Record<string, unknown> & { hooks?: Record<string, unknown> }
      const own = face()
      return { ...navigation, ...own, hooks: { ...navigation.hooks, ...own.hooks } }
    },
  }
}

export function installHeaderNavigation(slots: SlotFace, face: () => Record<string, unknown> & { hooks?: Record<string, unknown> }, component: unknown, priority: number): () => void {
  const name = 'conversation.session.header'
  let source: SlotEntryLike | undefined
  let dispose: (() => void) | undefined
  const refresh = (): void => {
    const entries = slots.entries(name).filter(entry => entry.component !== component)
    const next = navigationEntry(entries)
    if (dispose !== undefined && source === next) return
    dispose?.()
    source = next
    dispose = slots.register({ name, priority: freePriority(entries, { priority }), ...headerNavigation(entries, face) }, component)
  }
  // Slot declaration precedes the owner's registration. Follow that arrival,
  // and later host reloads, without treating our own registration as a source.
  const unsubscribe = slots.subscribe(name, refresh)
  try { refresh() } catch (error) { unsubscribe(); throw error }
  return () => { unsubscribe(); dispose?.() }
}
