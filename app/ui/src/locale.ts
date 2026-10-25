// The part of a locale service that the Bot views' copy (core/src/client/i18n.ts) uses:
// it registers its dictionary and translates through a bound namespace. The window has
// no host to hand one in, so this keeps its own.
export type Language = 'en' | 'zh'

type Dictionary = Record<string, string>
type Params = Record<string, unknown>

export interface LocaleService {
  readonly getLocale: () => { active: Language }
  readonly register: (namespace: string, language: string, dictionary: Dictionary) => () => void
  readonly bind: (namespace: string) => (key: string, params?: Params) => string
}

const fill = (text: string, params: Params | undefined): string => (params === undefined
  ? text
  : text.replace(/\{(\w+)\}/g, (match: string, name: string) => (name in params ? String(params[name]) : match)))

export function createLocale(tag: string): LocaleService {
  const active: Language = /^zh\b/iu.test(tag) ? 'zh' : 'en'
  const dictionaries = new Map<string, Dictionary>()
  return {
    getLocale: () => ({ active }),
    register(namespace, language, dictionary) {
      const key = `${namespace}:${language}`
      dictionaries.set(key, dictionary)
      return () => { dictionaries.delete(key) }
    },
    bind: namespace => (key, params) => fill(dictionaries.get(`${namespace}:${active}`)?.[key] ?? key, params),
  }
}
