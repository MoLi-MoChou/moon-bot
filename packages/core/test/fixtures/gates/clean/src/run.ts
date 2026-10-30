// The sanctioned ways to handle a promise. Every line here must stay green.
async function work(): Promise<number> {
  return 1
}
declare const cond: boolean

export async function run(): Promise<void> {
  await work()
  void work()
  work().then(() => undefined)
  work().catch(() => undefined)
  work().finally(() => undefined)
  void (cond && work())
  await (cond ? work() : work())
  let saved: Promise<number> | undefined
  saved = work()
  if (saved) await saved
}
