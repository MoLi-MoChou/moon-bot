// The host's secrets module. The records and the file live in ./secrets/store.ts, the
// redaction helpers in ./secrets/redact.ts, and the cards, endpoints and shell wiring
// in ./secrets/install.ts. This file keeps the names importers already used.
export { install } from './secrets/install.ts'
export {
  ENV_PREFIX,
  MAX_VALUE,
  MIN_VALUE,
  SECRET_NAME,
  WHOLE_VALUE,
  canUse,
  encodeUrlComponent,
  envName,
  normalizeName,
  redactDeep,
  redactor,
} from './secrets/redact.ts'
export type { Redact, RedactableSecret, SecretScope, SecretScopeHolder } from './secrets/redact.ts'
export type {
  SecretNote,
  SecretRecord,
  SecretRequest,
  SecretRequestStatus,
  SecretStore,
  SecretView,
} from './secrets/store.ts'
