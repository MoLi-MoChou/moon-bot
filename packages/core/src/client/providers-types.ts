/** Provider page types and shared helpers. */
import { hostText } from './i18n.ts'

// A model provider as the host reports it: its models, its key state, and whether it can go.
export interface ProviderModel {
  ref: string
  name: string
}
export interface Provider {
  id: string
  name: string
  key: {
    configured: boolean
    writable?: boolean
  } | null
  models: readonly ProviderModel[]
  error?: string
  removable?: boolean
}
// The page's view of the host's provider set.
export interface ProvidersView {
  available: boolean
  providers: readonly Provider[]
  addable: readonly {
    id: string
    name: string
  }[]
  protocols: readonly string[]
}
export interface ProvidersActions {
  providers: () => Promise<ProvidersView>
  setProviderKey: (id: string, key: string | null) => Promise<unknown>
  removeProvider: (id: string) => Promise<unknown>
  addProvider: (payload: Record<string, unknown>) => Promise<unknown>
  providerModels: (payload: { baseURL: string; api: string; key: string }) => Promise<
    readonly {
      id: string
      name?: string
    }[]
  >
}
export type RunWork = (work: Promise<unknown>) => Promise<boolean | undefined>
export type Apply = (promise: Promise<unknown>) => Promise<unknown>
export const PROTOCOL_NAMES: Record<string, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}
// Anthropic's SDK appends /v1/messages itself; the OpenAI ones take the /v1 root.
export const ENDPOINT_HINTS: Record<string, string> = { 'anthropic-messages': 'https://gateway.example' }
export const SHOWN_MODELS = 8
// A failure in the interface language; the dialog's error line shows it.
export const translated = <T>(promise: Promise<T>): Promise<T> =>
  Promise.resolve(promise).catch((failure: unknown) => {
    throw new Error(
      hostText(
        (
          failure as {
            message?: string
          } | null
        )?.message ?? String(failure),
      ),
    )
  })
