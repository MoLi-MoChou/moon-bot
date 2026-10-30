import { createElement as h } from 'react'
import { t } from './i18n.ts'
import type { TSidebarActions } from './sidebar-types.js'
import { MoonBotMark, PlugIcon } from './icons.tsx'

export function ConnectPlugins({
  wide,
  actions,
}: {
  readonly wide: boolean
  readonly actions: Pick<TSidebarActions, 'selectPanel'>
}) {
  if (!wide) return null
  return (
    <span className='bt-connect-wrap'>
      <button type='button' className='bt-connect bt-connect-foot' onClick={() => actions.selectPanel('plugins')}>
        <PlugIcon />
        {t('Connect plugins')}
      </button>
    </span>
  )
}
// Account seat of the Settings trigger: the visible label stays for assistive tech only.
export function YouAvatar() {
  return (
    <span className='bt-you-wrap'>
      <span className='bt-you' aria-hidden>
        <MoonBotMark size={24} />
      </span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {t('Settings')}
      </span>
    </span>
  )
}
