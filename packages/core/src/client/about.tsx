// Settings → About: the version, updates for Moon Bot and the runtime, and the links to
// the repository. The sidebar's cloud button shows the same update state.
import { createElement as h, useEffect, useState } from 'react'
import { GitHubMark } from './connectors.js'
import { AppUpdateRow, EngineRow, appBridge } from './about-updates.tsx'
import { whenText } from './feedback.tsx'
import { dateLocale, hostText, t, productName } from './i18n.ts'
import { StarLineIcon } from './icons.tsx'
import { MoonBotMark } from './icons.tsx'
// The desktop app's own updater and its engine downloader, as the app exposes them.
export interface AboutUpdate {
  phase?: string
  available?: boolean
  latest?: string
  installed?: string
  source?: string
  enabled?: boolean
  checkedAt?: number
  error?: string
  notesUrl?: string
  current?: string
  repoUrl?: string
  app?: {
    phase?: string
    version?: string
  }
}
export interface AboutActions {
  checkUpdate: () => Promise<unknown>
  installUpdate: () => Promise<unknown>
  openAppUpdates: (version?: string) => void
  openSettings: (page: string) => void
  repoStars: () => Promise<number>
}
export type RunWork = (work: Promise<unknown>) => Promise<boolean | undefined>
type SectionLike = React.ComponentType<Record<string, unknown>>
type RowLike = React.ComponentType<Record<string, unknown>>
// The length of the mark's `done` hop (bt-done in styles.js).
const CHEER_MS = 1800
const starCount = (count: number): string =>
  new Intl.NumberFormat(dateLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(count)
function botHint(update: AboutUpdate): string | null {
  if (update.phase === 'installing') return t('Updating Moon Bot…')
  if (update.phase === 'installed')
    return t('Restart to start using Moon Bot {version}.', { version: update.installed ?? update.latest })
  if (update.phase === 'failed')
    return t('The update did not finish: {reason}', { reason: hostText(update.error ?? '') })
  if (update.available) return t('Moon Bot {version} is available', { version: update.latest })
  if (update.source === 'app') return t('Updates come with the Moon Bot desktop app.')
  if (update.source === 'web') return t('The web version updates when its server is redeployed.')
  if (update.enabled === false) return t('Update checks are off.')
  if (update.source === 'path') return t('Installed from a local folder; update it there.')
  if (!update.checkedAt) return null
  if (!update.latest && update.source !== 'registry') return t('Updates are not offered for this install.')
  const checked = t('Checked {time}', { time: whenText(update.checkedAt) })
  return `${update.latest ? t('Up to date') : t('Could not check for updates.')} · ${checked}`
}
// Moon Bot patch: the desktop app's own updater (electron-updater in the app's main
// process): checks at launch and every few hours, downloads only the changed blocks,
// then installs silently on restart. This row lets the user check, watch, and restart.
const linkProps = (href: string): Record<string, string> => ({
  className: 'bt-soft bt-soft-sm bt-about-link',
  href,
  target: '_blank',
  rel: 'noopener noreferrer',
})
export function AboutPage({
  useUpdate,
  actions,
  run,
  Section,
  Row,
}: {
  useUpdate: <T>(select: (value: AboutUpdate) => T) => T
  actions: AboutActions
  run: RunWork
  Section: SectionLike
  Row: RowLike
}) {
  const update: AboutUpdate = useUpdate(value => value) ?? {}
  // Moon Bot patch: in the app, the version shown is the app's.
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    appBridge()
      ?.state()
      .then(
        value => setAppVersion(value?.current ?? ''),
        () => {},
      )
  }, [])
  const [checking, setChecking] = useState(false)
  const [stars, setStars] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    actions.repoStars().then(
      count => {
        if (live && Number.isInteger(count)) setStars(count)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [])
  // The whale hops when the page opens, after a check, and when an update is in.
  const [cheer, setCheer] = useState(true)
  useEffect(() => {
    if (!cheer) return undefined
    const timer = setTimeout(() => setCheer(false), CHEER_MS)
    return () => clearTimeout(timer)
  }, [cheer])
  const check = () => {
    setChecking(true)
    void run(actions.checkUpdate()).then(done => {
      setChecking(false)
      if (done) setCheer(true)
    })
  }
  const phase = update.phase ?? 'idle'
  useEffect(() => {
    if (phase === 'installed') setCheer(true)
  }, [phase])
  const botControl =
    phase === 'installed' || update.source === 'app' ? null : update.available || phase === 'installing' ? (
      <button
        type='button'
        className='bt-fb-primary'
        disabled={phase === 'installing'}
        onClick={() => run(actions.installUpdate())}>
        {phase === 'installing' ? t('Updating…') : phase === 'failed' ? t('Try again') : t('Update')}
      </button>
    ) : (
      <button
        type='button'
        className='bt-soft bt-soft-sm'
        disabled={checking || update.enabled === false}
        onClick={check}>
        {checking ? t('Checking…') : t('Check for updates')}
      </button>
    )
  const repo = update.repoUrl
  return [
    <div key='hero' className='bt-about-hero'>
      <span className='bt-about-mark'>
        <MoonBotMark size={52} />
      </span>
      <div className='bt-about-copy'>
        <span className='bt-about-name'>{productName()}</span>
        {appVersion || update.current ? (
          <span className='bt-about-version'>{t('Version {version}', { version: appVersion || update.current })}</span>
        ) : null}
      </div>
      {repo ? (
        <a
          className='bt-star'
          href={repo}
          target='_blank'
          rel='noopener noreferrer'
          title={t('Star Moon Bot on GitHub')}
          aria-label={
            stars === null
              ? t('Star Moon Bot on GitHub')
              : `${t('Star Moon Bot on GitHub')} · ${t('{count} stars', { count: stars })}`
          }>
          <span className='bt-star-main'>
            <span className='bt-star-icon'>
              <StarLineIcon />
            </span>
            Star
          </span>
          {stars === null ? null : <span className='bt-star-count'>{starCount(stars)}</span>}
        </a>
      ) : null}
    </div>,
    repo ? (
      <p key='ask' className='bt-about-ask'>
        {t('If Moon Bot helps you, a star on GitHub helps more people find it.')}
      </p>
    ) : null,
    update.source === 'web'
      ? h(Section, { key: 'updates', title: t('Updates') }, h(Row, { label: productName(), hint: botHint(update) }))
      : h(
          Section,
          { key: 'updates', title: t('Updates') },
          appBridge() ? <AppUpdateRow Row={Row} run={run} /> : null,
          <EngineRow Row={Row} run={run} />,
          appBridge()
            ? null
            : h(
                Row,
                { label: productName(), hint: botHint(update) },
                botControl,
                update.available && update.notesUrl ? <a {...linkProps(update.notesUrl)}>{t("What's new")}</a> : null,
              ),
        ),
    h(
      Section,
      { key: 'links', title: t('Links') },
      repo
        ? h(
            Row,
            { label: t('Source code'), hint: repo.replace(/^https:\/\//, '') },
            <a {...linkProps(repo)}>
              <GitHubMark />
              {t('Open')}
            </a>,
          )
        : null,
      update.notesUrl
        ? h(Row, { label: t('Release notes') }, <a {...linkProps(update.notesUrl)}>{t('Open')}</a>)
        : null,
      h(
        Row,
        { label: t('Runtime'), hint: t("Moon Bot's own runtime with built-in and ACP engines.") },
        <span>Apache-2.0</span>,
      ),
      h(
        Row,
        { label: t('Report a problem') },
        <button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.openSettings('feedback')}>
          {t('Open')}
        </button>,
      ),
    ),
  ]
}
export { ABOUT_CSS } from './about-css.ts'
