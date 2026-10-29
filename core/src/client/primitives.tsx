// The interface primitives the Bot views draw with, standalone edition: a plain-text
// renderer in place of a Markdown one, and no Agent mark. The desktop app's own build
// puts its richer module (react-markdown) in place of this one — see app/vite.config.js —
// so this file serves every other loader.
import { createElement as h, type ReactElement } from 'react'

const MENTION_ORIGIN = 'https://bots.local/'
const mentionLink = /\[([^\]\n]*)\]\(https:\/\/bots\.local\/([^\s)]+)\)/g

export const FishLogo = (): null => null

export interface MarkdownTextProps {
  readonly text: string
  readonly streaming?: boolean | undefined
  readonly labels?: unknown
  readonly variant?: string | undefined
  readonly fileMentions?: unknown
  readonly [key: string]: unknown
}

export function MarkdownText({ text }: MarkdownTextProps): ReactElement {
  const children: (string | ReactElement)[] = []
  let cursor = 0
  for (const match of text.matchAll(mentionLink)) {
    const start = match.index ?? 0
    if (start > cursor) children.push(text.slice(cursor, start))
    const label = match[1] ?? ''
    const id = match[2] ?? ''
    children.push(<a href={`${MENTION_ORIGIN}${id}`} className='bt-mention-link'>{label}</a>)
    cursor = start + match[0].length
  }
  if (cursor < text.length) children.push(text.slice(cursor))
  return <div className='md-plain'>{children}</div>
}
