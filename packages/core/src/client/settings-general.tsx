import { createElement as h } from 'react'
import { useEffect, useRef, useState } from 'react'
import { LEAN } from './lean.ts'
import { ACCENT_INKS, INKS } from './inks.ts'
import { allThemes, resolveThemeId } from './themes.ts'
import { FolderMenu } from './folder-menu.tsx'
import { t } from './i18n.ts'
import type { RunWork, SettingsActions, SettingsPrefs, SettingsRoster } from './settings-types.ts'
import { SetSection, SetRow, ThemePicker, capitalize } from './settings-chrome.tsx'

interface GeneralPageProps {
  roster: SettingsRoster
  actions: SettingsActions
  run: RunWork
}
export function GeneralPage({ roster, actions, run }: GeneralPageProps) {
  const prefs: SettingsPrefs = roster.prefs ?? {}
  const themes = allThemes()
  const current = resolveThemeId(themes, prefs.theme ?? '')
  const [custom, setCustom] = useState(prefs.accent ?? '#4d6bfe')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const pickCustom = (value: string): void => {
    setCustom(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void run(actions.setPrefs({ accent: value }))
    }, 350)
  }
  return [
    <SetSection key='look' title={t('Appearance')}>
      <SetRow label={t('Theme')} hint={t('Colors for the whole team, on every device.')}>
        <ThemePicker themes={themes} current={current} onPick={id => run(actions.setPrefs({ theme: id }))} />
      </SetRow>
      <SetRow label={t('Accent')} hint={t('Unread marks, badges, and the brand mark.')}>
        <div className='bt-swatches'>
          <button
            type='button'
            className='bt-swatch bt-swatch-default'
            title={t('Theme accent')}
            aria-label={t('Theme accent')}
            aria-pressed={!prefs.accent}
            onClick={() => {
              void run(actions.setPrefs({ accent: null }))
            }}
          />
          {ACCENT_INKS.map(ink => (
            <button
              key={ink}
              type='button'
              className='bt-swatch'
              title={t(capitalize(ink))}
              aria-label={t(capitalize(ink))}
              aria-pressed={prefs.accent === INKS[ink]?.[0]}
              style={{ background: INKS[ink]?.[0] }}
              onClick={() => run(actions.setPrefs({ accent: INKS[ink]?.[0] }))}
            />
          ))}
          <label
            className='bt-swatch bt-swatch-custom'
            title={t('Custom accent')}
            data-on={Boolean(prefs.accent) && !ACCENT_INKS.some(ink => INKS[ink]?.[0] === prefs.accent)}>
            <input
              type='color'
              value={custom}
              aria-label={t('Custom accent')}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => pickCustom(event.target.value)}
            />
          </label>
        </div>
      </SetRow>
    </SetSection>,
    LEAN.classicMode && actions.setSurface ? (
      <SetSection key='mode' title={t('Mode')}>
        <SetRow label={t('Classic Agent mode')}>
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.setSurface?.('agent')}>
            {t('Switch')}
          </button>
        </SetRow>
      </SetSection>
    ) : null,
    <LocationsSection key='places' actions={actions} run={run} />,
  ]
}
interface LocationsSectionProps {
  actions: SettingsActions
  run: RunWork
}
// The desktop app's preload hands its window `dsBotApp`; only there does the data location
// show, since the host keeps the plugin's data where it runs.
function LocationsSection({ actions, run }: LocationsSectionProps) {
  const app = window.dsBotApp
  const [team, setTeam] = useState<string | null>(null)
  const [data, setData] = useState<DsDataLocation | null>(null)
  // One change at a time: the data move checks the new folder against the team workspace, and
  // a later team workspace must not finish before an earlier one.
  const [moving, setMoving] = useState(false)
  const busy = useRef(false)
  useEffect(() => {
    void Promise.resolve(actions.folders())
      .then(info => setTeam(info?.team ?? null))
      .catch(() => {})
    if (app !== undefined)
      void Promise.resolve(app.dataLocation())
        .then(setData)
        .catch(() => {})
  }, [])
  const pickTeam = (path: string): Promise<boolean> | undefined => {
    if (busy.current) return undefined
    busy.current = true
    setMoving(true)
    return run(
      Promise.resolve(actions.setTeamWorkspace(path))
        .then(answer => {
          setTeam(answer.team)
          app?.teamWorkspaceChanged(answer.team)
        })
        .finally(() => {
          busy.current = false
          setMoving(false)
        }),
    )
  }
  return (
    <SetSection title={t('Locations')} className='bt-set-places'>
      <SetRow label={t('Team workspace')} hint={t('Where Bots without a folder of their own work.')}>
        {team === null ? null : (
          <FolderMenu value={team} team actions={actions} run={run} onPick={pickTeam} disabled={moving} />
        )}
      </SetRow>
      {data === null || app === undefined ? null : (
        <SetRow label={t('Data location')} hint={data.path}>
          {data.fixed ? null : (
            <button
              type='button'
              className='bt-soft bt-soft-sm'
              disabled={moving}
              onClick={() => {
                if (!busy.current) void run(app.moveData(team ?? undefined))
              }}>
              {t('Change…')}
            </button>
          )}
        </SetRow>
      )}
    </SetSection>
  )
}
