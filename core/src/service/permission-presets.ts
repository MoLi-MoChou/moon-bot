// The `permissionPresets` service the host asks for, now that the standalone product ships
// its own: it answers the catalog, remembers the preset a Session was given, and lets the
// tool gate read it back.
//
// The host sets a preset on a Session through `set(session, name)`. Sessions are the unit
// because that is where the host puts it — a Bot's own chat, each of its group Sessions, a
// fresh part — so a group's preset and a Bot's stay separate the way the host intends.
import { DEFAULT_PRESET, PRESETS, ceilingOf, hasPreset } from '../engine/permission-presets.ts'

export interface PresetSession {
  readonly id?: unknown
}

export class PermissionPresets {
  private readonly bySession = new Map<string, string>()

  catalog(): { readonly options: readonly { readonly value: string, readonly name: string, readonly description: string }[], readonly defaultPreset: string } {
    return { options: PRESETS, defaultPreset: DEFAULT_PRESET }
  }

  /** The known preset, or a refusal that names the ones there are. */
  resolve(name: string): string {
    if (!hasPreset(name)) throw new Error(`"${name}" is not a permission preset. Use one of: ${PRESETS.map(option => option.value).join(', ')}.`)
    return name
  }

  set(session: PresetSession | undefined, name: string): void {
    const id = typeof session?.id === 'string' ? session.id : ''
    if (id === '') return
    this.bySession.set(id, this.resolve(name))
  }

  /** A Session's preset, or undefined when it was never given one. */
  of(sessionId: string): string | undefined {
    return this.bySession.get(sessionId)
  }

  /** The risk level that may run without asking in a Session. */
  ceiling(sessionId: string): ReturnType<typeof ceilingOf> {
    return ceilingOf(this.bySession.get(sessionId))
  }

  /** A fresh conversational part starts from the host's default, as before. */
  forget(sessionId: string): void {
    this.bySession.delete(sessionId)
  }
}
