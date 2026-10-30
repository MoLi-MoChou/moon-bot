import { createElement as h } from 'react'

const Icon = (): null => null
const entry = { component: Icon }
const PAGE_ICONS: Record<string, typeof Icon> = {}

export const Sample = (): null => h(
  'div',
  null,
  h(Icon),
  h(entry.component),
  h(PAGE_ICONS['x']),
  <Icon />,
)
