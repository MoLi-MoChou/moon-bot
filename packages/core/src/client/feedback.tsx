// Settings → Feedback: report a problem as a GitHub issue with the diagnostics filled
// in, see the latest errors, and download the log. Also the toast for actions that
// fail away from any form (menus, the palette).
import { createElement as h, useEffect, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { clearClientErrors, clientErrors, clientFacts, failureLabel, issueUrl, WHAT_MAX } from './diagnostics.ts'
import { dateLocale, t } from './i18n.ts'
export { ErrorToast } from './feedback-toast.tsx'
export const FeedbackIcon = () => (
  <svg
    width={15}
    height={15}
    viewBox='0 0 20 20'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.5}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden>
    <path d='M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z' />
    <path d='M10 7v2.6M10 11.4h.01' />
  </svg>
)
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
// No clipboard API (an insecure context, a locked-down WebView) is a failure,
// not a success: the caller then opens the preview to copy by hand.
const copy = (text: string): Promise<boolean> =>
  navigator.clipboard === undefined
    ? Promise.resolve(false)
    : navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      )
export function whenText(time: number | string): string {
  const date = new Date(time)
  const today = new Date().toDateString() === date.toDateString()
  const clock = date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  return today ? clock : `${date.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })} ${clock}`
}
export interface FeedbackEntry {
  readonly time: number | string
  readonly source: string
  readonly text: string
  readonly code?: string
  readonly status?: number | string
  readonly level?: string
  readonly bot?: string
  readonly where?: string
}
function entrySummary(entry: FeedbackEntry): string {
  if (entry.source === 'turn') return failureLabel(entry.code ?? '', entry.text)
  return entry.text
}
const SOURCES: Record<string, string> = {
  turn: 'Model call',
  host: 'Moon Bot',
  api: 'Moon Bot',
  browser: 'This window',
}
export interface DiagnosticsReport {
  readonly entries: readonly FeedbackEntry[]
  readonly total: number
  readonly markdown: string
  readonly issuesUrl: string
}
interface IssueWindow {
  go(url: string): boolean
}
// Where the new issue opens; `go(url)` tells whether it did. In a browser the window is
// reserved inside the click gesture and addressed once the diagnostics are gathered:
// opening after the awaits would hit the popup blocker. The Desktop makes no window. It
// hands an http(s) address to the system browser, has no blocker, and returns null even
// then, so it gets the address itself.
function issueWindow(): IssueWindow {
  if (window.dshDesktop !== undefined)
    return {
      go: (url: string): boolean => {
        window.open(url, '_blank')
        return true
      },
    }
  const reserved = window.open('', '_blank')
  if (reserved !== null) reserved.opener = null
  return {
    go: (url: string): boolean => {
      if (reserved === null) return false
      reserved.location.href = url
      return true
    },
  }
}
interface FeedbackActions {
  diagnostics(input: {
    readonly client: Record<string, string>
    readonly clientErrors: unknown
  }): Promise<DiagnosticsReport>
  diagnosticsLog(): Promise<string>
  diagnosticsClear(): Promise<unknown>
  dismissToast(token: string): void
  openSettings(page: string): void
}
type SectionComponent = (props: { readonly title?: string; readonly children?: ReactNode }) => ReactNode
type RowComponent = (props: {
  readonly label?: string
  readonly hint?: string
  readonly children?: ReactNode
}) => ReactNode
interface FeedbackPageProps {
  readonly actions: FeedbackActions
  readonly run: <T>(work: Promise<T>) => Promise<unknown>
  readonly Section: SectionComponent
  readonly Row: RowComponent
}
export function FeedbackPage({ actions, run, Section, Row }: FeedbackPageProps) {
  const [what, setWhat] = useState('')
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [preview, setPreview] = useState(false)
  const [note, setNote] = useState('')
  // Each action reads the report again, so it holds errors from the last few seconds.
  const fetchReport = () =>
    actions.diagnostics({ client: clientFacts(), clientErrors: clientErrors() }).then(next => {
      setReport(next)
      return next
    })
  const load = () => fetchReport().then(() => undefined)
  useEffect(() => {
    void run(load())
  }, [])
  const copyReport = (): Promise<unknown> =>
    run(
      fetchReport().then(async next => {
        const copied = await copy(next.markdown)
        setNote(copied ? t('Copied the diagnostics.') : t('Could not copy. Select the text below and copy it.'))
        if (!copied) setPreview(true)
      }),
    )
  const [issueLink, setIssueLink] = useState<string | null>(null)
  const openIssue = (): Promise<unknown> => {
    const target = issueWindow()
    return run(
      fetchReport().then(async next => {
        const copied = await copy(next.markdown)
        const { url, inline } = issueUrl(next.issuesUrl, { what, diagnostics: next.markdown })
        if (target.go(url)) {
          setIssueLink(null)
          setNote(
            inline
              ? t('Opened a new GitHub issue with the diagnostics filled in. Check it before you submit.')
              : copied
                ? t(
                    'Opened a new GitHub issue. The diagnostics are long, so they are on the clipboard: paste them into the issue.',
                  )
                : t('Opened a new GitHub issue. Copy the diagnostics below into it.'),
          )
        } else {
          setIssueLink(url)
          setNote(t('The browser blocked the new window.'))
        }
        if (!inline && !copied) setPreview(true)
      }),
    )
  }
  const downloadLog = (): Promise<unknown> =>
    run(
      actions.diagnosticsLog().then(text => {
        download('moon-bot-diagnostics.log', text || 'No entries.\n')
        setNote(t('Downloaded the log. Keys, tokens, and your home folder are hidden in it.'))
      }),
    )
  const clearLog = (): Promise<unknown> =>
    run(
      actions
        .diagnosticsClear()
        .then(clearClientErrors)
        .then(load)
        .then(() => {
          setNote(t('Cleared the error log.'))
        }),
    )
  const browserErrors: FeedbackEntry[] = report ? clientErrors().map(entry => ({ ...entry, source: 'browser' })) : []
  const entries = [...(report?.entries ?? []), ...browserErrors].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  )
  const total = (report?.total ?? 0) + browserErrors.length
  const shown = entries.slice(0, 8)
  return [
    h(
      Section,
      { key: 'report', title: t('Report a problem') },
      <div className='bt-set-row bt-set-paste bt-fb-what'>
        <label className='bt-set-copy' htmlFor='bt-fb-what'>
          <span>{t('What happened?')}</span>
          <span className='bt-set-hint'>
            {t('What you did, what you expected, and what happened instead. It goes into the issue.')}
          </span>
        </label>
        <textarea
          id='bt-fb-what'
          className='bt-input bt-input-area'
          value={what}
          maxLength={WHAT_MAX}
          placeholder={t('For example: I asked Writer in the group chat and it showed an error.')}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setWhat(event.target.value)}
        />
      </div>,
      h(
        Row,
        {
          label: t('Diagnostics'),
          hint: t(
            'Versions, system, models, and the latest errors. Saved keys, tokens, and your home folder are hidden.',
          ),
        },
        <button
          type='button'
          className='bt-soft bt-soft-sm'
          onClick={() => setPreview(!preview)}
          aria-expanded={preview}>
          {preview ? t('Hide') : t('Show')}
        </button>,
        <button type='button' className='bt-soft bt-soft-sm' onClick={copyReport}>
          {t('Copy')}
        </button>,
      ),
      preview ? (
        <div className='bt-set-row bt-fb-preview'>
          <pre tabIndex={0} aria-label={t('Diagnostics')}>
            {report?.markdown || t('Loading…')}
          </pre>
        </div>
      ) : null,
      h(
        Row,
        {
          label: t('GitHub issue'),
          hint: t(
            'Opens a new issue in the Moon Bot repository with all of this filled in. Nothing is sent until you submit it there.',
          ),
        },
        <button type='button' className='bt-fb-primary' onClick={openIssue}>
          {t('Report on GitHub')}
        </button>,
      ),
    ),
    note ? (
      <div key='note' className='bt-note bt-fb-note' role='status'>
        {note}
        {issueLink
          ? [
              ' ',
              <a key='link' href={issueLink} target='_blank' rel='noopener noreferrer'>
                {t('Open the issue')}
              </a>,
            ]
          : null}
      </div>
    ) : null,
    h(
      Section,
      { key: 'errors', title: report ? t('Recent errors · {count}', { count: total }) : t('Recent errors') },
      shown.length === 0
        ? h(Row, {
            label: t('No errors recorded.'),
            hint: t('Failed model calls and Moon Bot problems show here, newest first.'),
          })
        : shown.map((entry, index) => (
            <div key={`${entry.time}-${index}`} className='bt-set-row bt-fb-entry' title={entry.text}>
              <span className='bt-fb-dot' data-level={entry.level} aria-hidden />
              <div className='bt-set-copy'>
                <span className='bt-fb-text'>{entrySummary(entry)}</span>
                <span className='bt-set-hint'>
                  {[whenText(entry.time), entry.bot, entry.where, t(SOURCES[entry.source] ?? 'Moon Bot')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {entry.code ? (
                <span className='bt-tag bt-fb-code'>{entry.status ? `${entry.code} ${entry.status}` : entry.code}</span>
              ) : null}
            </div>
          )),
      h(
        Row,
        { label: t('Error log'), hint: t('Kept on this computer across restarts, up to about 1 MB.') },
        <button type='button' className='bt-soft bt-soft-sm' onClick={downloadLog}>
          {t('Download')}
        </button>,
        <button type='button' className='bt-soft bt-soft-sm' onClick={clearLog} disabled={!report || total === 0}>
          {t('Clear')}
        </button>,
      ),
    ),
  ]
}
export { FEEDBACK_CSS } from './feedback-css.ts'
