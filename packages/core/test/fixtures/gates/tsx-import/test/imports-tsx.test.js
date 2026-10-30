// A test that reaches for a component: Node's type stripping cannot load `.tsx`, so this
// must fail the gate rather than crash `npm test` with an unknown-extension error.
import { ok } from '../src/card.tsx'
export const value = ok
