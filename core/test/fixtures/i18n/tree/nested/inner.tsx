// Nested one level down: the older top-level-only scan never read this file.
export const inner = (t: (key: string) => string): string => t('Missing from a nested file')
