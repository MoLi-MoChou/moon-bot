// The window's own versions of the interface primitives the Bot views draw with (see
// core/src/client/primitives.tsx and app/vite.config.js): the markdown renderer the
// plugin host would otherwise supply.
import { createElement as h, useMemo, useRef, useState, type ReactElement } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MENTION_ORIGIN } from '../../../core/src/client/text.ts'

/** The Agent mark the plugin host drew; this product has no Agent, so nothing draws one. */
export const FishLogo = (): null => null

/** The labels a markdown renderer takes from the Bot views' copy. */
export interface MarkdownLabels {
  readonly code?: { readonly copyLabel?: string; readonly copiedLabel?: string } | undefined
}

export interface MarkdownTextProps {
  readonly text?: string | undefined
  readonly labels?: MarkdownLabels | undefined
  readonly variant?: string | undefined
  readonly [key: string]: unknown
}

const PLUGINS = [remarkGfm]

function CodeBlock({ children, labels }: { readonly children?: React.ReactNode; readonly labels?: MarkdownLabels | undefined }): ReactElement {
  const [copied, setCopied] = useState(false)
  const block = useRef<HTMLPreElement>(null)
  const copy = (): void => {
    void navigator.clipboard?.writeText(block.current?.innerText ?? '').then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1000)
    })
  }
  return <div className='md-code'>
    <button type='button' className='md-copy' onClick={copy}>{copied ? labels?.code?.copiedLabel : labels?.code?.copyLabel}</button>
    <pre ref={block}>{children}</pre>
  </div>
}

// Links open outside the window; mention links stay for the chat's own click handler.
const elements = (labels: MarkdownLabels | undefined): Components => ({
  a: ({ node: _node, ...props }) => <a {...props} {...(typeof props.href === 'string' && props.href.startsWith(MENTION_ORIGIN) ? {} : { target: '_blank', rel: 'noreferrer' })} />,
  pre: ({ children }) => <CodeBlock labels={labels}>{children}</CodeBlock>,
})

// The class keeps the `_markdown` stem that the Bot views' styles give the markdown.
export function MarkdownText({ text, labels, variant }: MarkdownTextProps): ReactElement {
  // New element types on every render would remount each code block as a reply streams in.
  const components = useMemo(() => elements(labels), [labels?.code?.copyLabel, labels?.code?.copiedLabel])
  return <div className={variant === 'compact' ? 'md_markdown md-compact' : 'md_markdown'}>
    <Markdown remarkPlugins={PLUGINS} components={components}>{text ?? ''}</Markdown>
  </div>
}
