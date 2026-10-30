// Apply a memory-review change list for one keeper.
import type { ApplyInput, ChangeResult, MemoryStorage } from '../memory-types.ts'
import type { MemoryMetaInput } from './records.ts'
import { DENIED, GONE, NO_MATCH, cleanEntry, cleanTopic, errorCode, errorMessage } from './records.ts'
import type { MemoryRuntime } from '../memory-types.ts'

export interface ApplyReviewDeps {
  readonly getStorage: () => MemoryStorage
  readonly rt: Pick<MemoryRuntime, 'botOf' | 'warn'>
}

export async function applyReview({
  keeper,
  name,
  home,
  numbered,
  changes,
  source,
  teamWrites,
  getStorage,
  rt,
}: ApplyInput & ApplyReviewDeps): Promise<number> {
  const store = getStorage()
  const actor = { id: keeper.id, name: keeper.name, auto: true }
  const done: ChangeResult[] = []
  let failed: unknown
  for (const change of changes) {
    // A keeper deleted mid-review keeps no more changes, its team ones included.
    if (rt.botOf(keeper.id) === undefined) return 0
    // Its role may change mid-review too, so each change asks again.
    const team = teamWrites()
    const op = String(change.op ?? '')
    const topic = op === 'add' && change.topic !== undefined ? cleanTopic(String(change.topic)) : undefined
    const target = numbered[Number(change.entry) - 1]
    const scope =
      op === 'add' ? (change.team === true && team ? store.TEAM : home) : target?.scope === 'team' ? store.TEAM : home
    const label = store.labelOf(scope, keeper.id)
    const text = cleanEntry(change.text)
    const meta: MemoryMetaInput = {
      source,
      ...(scope.kind === 'team' ? { by: keeper.name } : {}),
      added: store.today(),
    }
    try {
      if (op !== 'add' && target === undefined) continue
      if (scope.kind === 'team' && !team) continue
      if ((op === 'add' || op === 'edit') && store.entryProblem(text) !== undefined) continue
      if (op === 'add') done.push(await store.addEntry({ scope, topic, text, meta, actor, label }))
      else if (op === 'edit' && target !== undefined)
        done.push(
          await store.replaceEntry({ scope, topic: target.file.topic, match: target.text, text, meta, actor, label }),
        )
      else if (op === 'remove' && target !== undefined)
        done.push(await store.removeEntry({ scope, topic: target.file.topic, match: target.text, actor, label }))
    } catch (failure) {
      if (errorCode(failure) === GONE) return 0
      rt.warn('moon-bot: memory review of %s left out a change: %s', name, errorMessage(failure))
      if (errorCode(failure) !== NO_MATCH && errorCode(failure) !== DENIED) failed ??= failure
    }
  }
  // A full file or a failed write is no reason to pass the lines: the next
  // review reads them again, and its request shows how full MEMORY.md is.
  if (failed !== undefined) throw failed
  return done.filter(result => result.changed).length
}
