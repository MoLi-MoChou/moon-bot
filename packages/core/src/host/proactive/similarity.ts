// Telling whether two candidates say the same thing, without an embedding service.
//
// The plan asked for cosine similarity over embeddings. This build has no embedding
// provider — nothing in core/ computes one — so the comparison is done locally in two
// passes: an exact fingerprint first, then keyword-set overlap. The overlap catches
// rewording only as far as the words survive, which is weaker than a real embedding;
// DELIVERY_THRESHOLD is set with that in mind, and `similarityOf` is the seam to replace
// if an embedding path ever exists.
import { createHash } from 'node:crypto'

/** Words that say nothing about the subject, in the two languages the app ships. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may',
  'might', 'must', 'shall', 'not', 'no', 'yes', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'me', 'us', 'them',
  'about', 'into', 'over', 'under', 'up', 'down', 'out', 'again', 'still', 'just', 'also',
  'very', 'more', 'most', 'some', 'any', 'all', 'each', 'every', 'there', 'here', 'when',
  'what', 'which', 'who', 'how', 'why', 'one', 'two', 'now', 'yet', 'already', 'only',
  '的', '了', '是', '在', '和', '与', '或', '也', '都', '就', '不', '没', '有', '我', '你',
  '他', '她', '它', '这', '那', '个', '些', '上', '下', '里', '中', '把', '被', '让', '给',
  '要', '会', '能', '可以', '还', '再', '又', '很', '更', '最', '一', '二', '三', '个',
])

/**
 * The words that carry the subject: lowercased, punctuation dropped, stop words removed.
 * Latin text is split on whitespace; each Han character is its own token, because there
 * are no spaces to split on and the characters are the unit that repeats.
 */
export function topicKeysOf(text: string): readonly string[] {
  const folded = text.toLowerCase()
  const tokens: string[] = []
  const latin = /[a-z0-9]+(?:[._-][a-z0-9]+)*/g
  for (const match of folded.matchAll(latin)) tokens.push(match[0])
  for (const match of folded.matchAll(/[\u4e00-\u9fff]/g)) tokens.push(match[0])
  const kept = tokens.filter(token => !STOP.has(token) && token.length > 0)
  return [...new Set(kept)]
}

/** An exact-content hash: the cheap first pass, before any comparison. */
export function fingerprintOf(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 32)
}

/**
 * How alike two keyword sets are, from 0 to 1.
 *
 * The score is the share of words in common out of everything either set mentions, so a
 * set that is a subset of the other still lands well below 1. That is deliberate: a bag of
 * words cannot tell "the tests are failing" from "the tests pass", because the word that
 * reverses the meaning is exactly the word that differs. Scoring by overlap means such a
 * pair stays below the line, and a genuinely new fact about a familiar subject is not
 * swallowed as a repeat.
 *
 * Chinese is the awkward case: there are no spaces, so each character is a token and a
 * two-character word is two tokens. A short Chinese subject is therefore NOT one token,
 * but it is still the whole subject ("周报" against "周报 第 3 节 还是空的"). So containment
 * decides when the shorter side is at most two tokens, which covers a one-word Latin
 * subject and a one-word Chinese one alike.
 */
export function similarityOf(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const left = new Set(a)
  const right = new Set(b)
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  if (shared === 0) return 0
  // A one-word Latin subject and a one-word Chinese subject are both here: at most two
  // tokens is short enough that the shared part IS the subject.
  if (Math.min(left.size, right.size) <= 2) return shared / Math.min(left.size, right.size)
  return shared / (left.size + right.size - shared)
}

/** Above this, two candidates are treated as the same subject. Calibrated by tests. */
export const SAME_SUBJECT = 0.55

/** Whether a candidate repeats one already issued or turned down in the window. */
export function repeatsEarlier(
  candidate: { readonly fingerprint: string; readonly topicKeys: readonly string[] },
  earlier: readonly { readonly fingerprint: string; readonly topicKeys: readonly string[] }[],
): { readonly repeats: boolean; readonly against: string | undefined } {
  for (const other of earlier) {
    if (other.fingerprint === candidate.fingerprint) return { repeats: true, against: other.fingerprint }
    if (similarityOf(candidate.topicKeys, other.topicKeys) >= SAME_SUBJECT) return { repeats: true, against: other.fingerprint }
  }
  return { repeats: false, against: undefined }
}
