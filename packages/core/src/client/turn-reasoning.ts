// Settled and live reasoning of every loaded step in a Turn, shown once on the last
// step that has reasoning: only steps with reasoning get a reasoning part to render
// it. Sitting under the Turn's tool lines keeps the row directly above the reply.
export interface ReasoningBlock { kind?: string; text?: string }
export interface ReasoningStep {
  step?: number
  status?: string
  blocks?: ReasoningBlock[]
  time?: number
}

export function turnReasoning(steps: readonly ReasoningStep[], current: ReasoningStep): string {
  const members = steps.length > 0 ? steps : [current]
  let lastReasoning: ReasoningStep | undefined
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const member = members[index]
    if (member !== undefined && stepReasoning(member) !== '') { lastReasoning = member; break }
  }
  if (lastReasoning?.step !== current.step) return ''
  return members.map(stepReasoning).filter(Boolean).join('\n\n')
}

// A step still streaming reasoning with no reply text yet is thinking: the row
// counts its clock from `step.time`, the time its first visible chunk arrived.
export const thinkingStep = (steps: readonly ReasoningStep[]): ReasoningStep | undefined => steps.find(thinkingLive)

const thinkingLive = (step: ReasoningStep): boolean => step.status === 'running' && texts(step).length === 0 && (step.blocks ?? []).some(block => block.kind === 'reasoning')

const texts = (step: ReasoningStep): ReasoningBlock[] => (step.blocks ?? []).filter(block => block.kind === 'text' && String(block.text ?? '').trim() !== '')

const stepReasoning = (step: ReasoningStep): string => (step.blocks ?? []).filter(block => block.kind === 'reasoning').map(block => String(block.text ?? '')).join('\n').trim()
