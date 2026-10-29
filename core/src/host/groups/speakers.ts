// Who a post calls: the members a group post opens a round with. The rule depends only on
// the post's own flags and the names it mentions, so it lives beside the round code but
// outside its install closure.
import type { StoredBot } from '../runtime.ts'
import type { GroupRuntime, GroupRoom, RoomPost } from './types.ts'
import { mentionsIn } from './notice.ts'

/** The members a post calls, in the order the round speaks to them. */
export function openingSpeakersOf(rt: GroupRuntime, room: GroupRoom, opener: RoomPost): StoredBot[] {
  const everyone = room.members.map(rt.botOf).filter((bot): bot is StoredBot => bot !== undefined)
  const members = everyone.filter(bot => bot.id !== opener.botId)
  const admin = members.find(bot => rt.isAdminOf(room, bot.id))
  if (opener.kickoff) return admin ? [admin] : []
  if (opener.quiet) return []
  if (opener.done) return members.filter(bot => bot.id === opener.askedBy)
  const { all, found: named } = mentionsIn(opener.text ?? '', everyone, opener.references)
  const found = named.filter(bot => bot.id !== opener.botId)
  if (opener.progress) return found
  if (opener.late) return found.length > 0 ? found : members.filter(bot => bot.id === opener.askedBy)
  if (opener.member) return found
  if (found.length > 0 && !all) return found
  if (!all && room.mode === 'admin' && admin) return [admin]
  return admin ? [admin, ...members.filter(bot => bot !== admin)] : members
}
