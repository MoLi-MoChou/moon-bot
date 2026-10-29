// the host's main view opens only a Session that its client list already holds; any other id
// throws `sessions.retain: unknown session`. A part the Host made a moment ago, or any part
// before the first list arrives, waits for the list; a newer navigation — through here or
// elsewhere — drops the wait.
interface SessionList {
  getSnapshot(): { byId?: Record<string, unknown> }
  subscribe(listener: () => void): () => void
}

export interface ListedOpenerOptions {
  list: SessionList
  open: (target: string) => void
  refresh?: () => void
  current?: () => unknown
}

export function listedOpener({ list, open, refresh, current }: ListedOpenerOptions): (target: string) => void {
  let drop: () => void = () => {}
  return (target: string): void => {
    drop()
    drop = () => {}
    const listed = (): boolean => list.getSnapshot().byId?.[target] !== undefined
    if (listed()) { open(target); return }
    const from = current?.()
    const off = list.subscribe(() => {
      if (current?.() !== from) {
        off()
        drop = () => {}
        return
      }
      if (!listed()) return
      off()
      drop = () => {}
      open(target)
    })
    drop = off
    refresh?.()
  }
}
