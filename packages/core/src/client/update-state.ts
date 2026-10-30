// Version comparison for the update cards: the app's own updater and the Bot's release
// check both answer "is this newer", and both may carry a leading `v` or build metadata.
const bare = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/^v/iu, '')
    .split('+')[0] ?? ''

export const sameVersion = (a: unknown, b: unknown): boolean => bare(a) !== '' && bare(a) === bare(b)
