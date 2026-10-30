export interface CustomConnectorActions {
  saveCapability: (payload: Record<string, unknown>) => Promise<unknown>
  deleteCapability: (name: string) => Promise<unknown>
  setBotCapability: (botId: string, name: string, attached: boolean) => Promise<unknown>
  retryCapability: (name: string) => Promise<unknown>
  testCapability: (
    payload: Record<string, unknown>,
  ) => Promise<{ readonly tools: readonly string[]; readonly ms: number }>
}
