// The DSH session-reference package, as at-menu.test.ts uses it. It resolves at run
// time through test/harness-resolve.mjs from dev/harness; the loose declaration keeps
// the type check off that install (the same idea src/host/dsh-packages.d.ts uses).
declare module '@deepseek-ai/dsh-session-reference' {
  export function formatSessionReferenceMention(reference: { sessionId: string, label: string }): string
  export function parseSessionReferenceText(text: string): { text: string, references: { sessionId: string, label: string }[] }
}
