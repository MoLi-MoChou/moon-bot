// The first-run import reads every chat of the team once, with the app's own DSH, before it copies it.

export interface CheckHandle {
  read(): Promise<unknown>
  close(): Promise<void>
}

export interface CheckPersistence {
  open(id: string, access: 'read'): Promise<CheckHandle>
}

/**
 * The Sessions that this DSH refuses to read because a newer DSH wrote them. A damaged log is
 * not one of them: the user's own DSH cannot read it either, so it does not stop the import.
 */
export async function unreadableSessions(persistence: CheckPersistence, ids: readonly string[]): Promise<string[]> {
  const unreadable: string[] = []
  for (const id of ids) {
    try {
      const handle = await persistence.open(id, 'read')
      try {
        await handle.read()
      } finally {
        await handle.close()
      }
    } catch (error) {
      const name = typeof error === 'object' && error !== null ? (error as { readonly name?: unknown }).name : undefined
      if (name === 'SessionFormatUnsupportedError') unreadable.push(id)
      else console.warn(`Moon Bot: could not read ${id} while checking the team: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return unreadable
}
