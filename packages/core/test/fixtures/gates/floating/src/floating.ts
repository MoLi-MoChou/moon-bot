// Every form that hides a promise from a bare `work()` statement. Each function is one case,
// and test/lint-gates.test.js asserts the line that is reported for each of them.
async function work(): Promise<number> {
  return 1
}
async function other(): Promise<number> {
  return 2
}
declare const cond: boolean
declare const maybe: string | undefined

export async function bare(): Promise<void> {
  work()
}

export async function parenthesized(): Promise<void> {
  (work())
}

export async function asserted(): Promise<void> {
  work() as Promise<number>
}

export async function angleAsserted(): Promise<void> {
  <Promise<number>>work()
}

export async function nonNull(): Promise<void> {
  work()!
}

export async function logicalAnd(): Promise<void> {
  cond && work()
}

export async function logicalOr(): Promise<void> {
  cond || other()
}

export async function nullish(): Promise<void> {
  maybe ?? work()
}

export async function conditionalWhenTrue(): Promise<void> {
  cond ? work() : undefined
}

export async function conditionalWhenFalse(): Promise<void> {
  cond ? undefined : other()
}

export async function bareNew(): Promise<void> {
  new Promise<void>(resolve => resolve())
}

export async function comma(): Promise<void> {
  (work(), other())
}

export async function bareIdentifier(): Promise<void> {
  const pending = work()
  pending
}

export async function satisfies(): Promise<void> {
  work() satisfies Promise<number>
}
