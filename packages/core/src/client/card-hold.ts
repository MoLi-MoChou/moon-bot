import { useLayoutEffect, useRef } from 'react'

export interface DockHoldActions {
  noteHeldCard?: (sessionId: string, kind: string, requestId: string, delta: number) => void
}

// Keep an edited dock card in place when its history cell mounts. Only the
// request's identity is shared; drafts and secret values stay in the component.
export function useDockHold(sessionId: string, kind: string, requestId: string, actions: DockHoldActions, inline: boolean): () => void {
  const release = useRef<(() => void) | null>(null)
  const note = actions.noteHeldCard
  useLayoutEffect(() => () => {
    const stop = release.current
    release.current = null
    stop?.()
  }, [sessionId, kind, requestId, note, inline])
  return () => {
    if (inline || release.current !== null || note === undefined) return
    release.current = () => note(sessionId, kind, requestId, -1)
    note(sessionId, kind, requestId, 1)
  }
}
