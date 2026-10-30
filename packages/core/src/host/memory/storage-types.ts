/** Types extracted. */
import type { NoteNews } from '../memory-types.ts'

export interface StorageDeps {
  readonly reviewOn: boolean
  readonly noteNews: NoteNews
}
export interface ActorFields {
  readonly actor: string
  readonly actorName: string
  readonly auto?: boolean | undefined
}
