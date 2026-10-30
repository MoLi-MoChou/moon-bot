// Constants and clip helper for memory news / review.
export const NEWS_TEXT_MAX = 160
export const REVIEW_READ_MS = 15_000
export const REVIEW_FIRST_LINES = 6
export const REVIEW_CONTEXT_LINES = 4
export const REVIEW_PASSES_MAX = 4
export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)} …(cut)` : text)
