// A value import of the type-only contract would be a runtime import of a file that
// does not exist: the import must be `import type`.
import { startTimer } from './host-types.js'
export const value = startTimer
