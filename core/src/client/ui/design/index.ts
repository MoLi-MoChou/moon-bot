// The design system's public sheets.
//
// The styles shipped as one file; they are split here by surface, but the fragments are
// still concatenated in their shipped order because CSS cascade and source order are
// part of the design. Do not reorder the arguments.
import { CONVERSATION_CARDS_CSS, CONVERSATION_CELLS_CSS, MESSAGE_ACTIONS_CSS } from './conversation.ts'
import { CONVERSATION_COMPOSER_CSS, NEW_CHAT_CSS } from './composer.ts'
import { MARKS_CSS } from './marks.ts'
import { OVERLAYS_CSS } from './overlays.ts'
import { MEMORY_DIALOG_CSS, PANELS_CSS } from './panels.ts'
import { SHELL_CHROME_CSS, SHELL_FRAME_CSS, SHELL_NOTICE_CSS } from './shell.ts'
import { BASE_TOKENS_CSS } from './tokens.ts'

// The first fragment starts with the newline the original template opened with; the
// final newline is the one before its closing backtick.
const sheet = (...fragments: readonly string[]): string => `${fragments.join('')}\n`

export const SHELL_CSS = sheet(
  BASE_TOKENS_CSS,
  MARKS_CSS,
  SHELL_FRAME_CSS,
  CONVERSATION_CARDS_CSS,
  NEW_CHAT_CSS,
  PANELS_CSS,
  SHELL_CHROME_CSS,
  MESSAGE_ACTIONS_CSS,
  OVERLAYS_CSS,
  MEMORY_DIALOG_CSS,
  SHELL_NOTICE_CSS,
)

export const CONVERSATION_CSS = sheet(CONVERSATION_CELLS_CSS, CONVERSATION_COMPOSER_CSS)

export { installCompiledStyles, installStyles } from './tokens.ts'
