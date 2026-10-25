// The interface primitives the Bot views draw with, standalone edition: a plain-text
// renderer where DSH's MarkdownText was, and no DSH Agent mark. The desktop app's own
// build puts its richer module (react-markdown) in place of this one — see
// app/vite.config.js — so this file serves every other loader.
import { createElement as h, type ReactElement } from 'react'

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
  return h('div', { className: 'md-plain' }, text)
}
