// The core package's exports map points at plain JS (dist/service/server.js) with no
// "types" condition, so this says the shape service-host.ts uses. Keep it in step with
// core/src/service/server.ts (startService, StandaloneService).
declare module 'moon-bot-core/service' {
  export interface ServiceOptions {
    readonly home: string | undefined
    readonly password?: string | undefined
    readonly uiDir?: string | undefined
    readonly host?: string | undefined
    readonly port?: number | undefined
    readonly logger?: boolean | undefined
  }
  export interface StandaloneService {
    readonly url: string
    close(): Promise<void>
  }
  export function startService(options: ServiceOptions): Promise<StandaloneService>
}
