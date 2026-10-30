// The page reader for `read_browser`. `readPage` runs inside the Bot's webview, so it is
// serialized with Function.prototype.toString: it must not use any name from this module
// or any import, only its own locals and the page's globals.
// Finished blocks (list/quote/table/code/frame) are stashed behind tokens so whitespace
// clean-up cannot touch their indentation; preformatted lines use \u0003 instead of \u0002.
export type { ReadLimits, ReadItem, ReadPage } from './read-page-types.ts'
export { READ_LIMITS } from './read-page-types.ts'
export { readPage } from './read-page-walk.ts'
import { READ_LIMITS } from './read-page-types.ts'
import type { ReadLimits } from './read-page-types.ts'
import { readPage } from './read-page-walk.ts'

/** The reader as one expression for `executeJavaScript`. */
export const readPageScript = (limits: ReadLimits = READ_LIMITS): string => `(${readPage})(${JSON.stringify(limits)})`

export const READ_PAGE_SCRIPT = readPageScript()
