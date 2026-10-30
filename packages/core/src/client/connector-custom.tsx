// Custom connectors barrel — form, list, and draft helper.
export type { CustomConnectorActions } from './connector-custom-actions.ts'
export { CustomConnectorForm } from './connector-custom-form.tsx'
export { CustomConnectorList, AddCustomConnector } from './connector-custom-list.tsx'
import type { Capability } from './capability-types.ts'
import { draftFromConnector, type CustomConnectorDraft } from './connector-custom.ts'

export function customConnectorDraftOf(item: Capability): CustomConnectorDraft {
  return draftFromConnector(item)
}
