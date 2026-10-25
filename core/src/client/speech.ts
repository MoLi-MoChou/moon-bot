// The recognizer of DSH's Voice Input plugin (local SenseVoice). Its `speech` Remote
// exists only while that plugin is on; the browser's own speech service stays the
// fallback. The plugin takes one complete 16 kHz mono PCM16 WAV per request.
export const VOICE_BUNDLE = 'voice-input'
const USABLE = new Set(['ready', 'standby', 'waking'])

export interface SpeechProvider {
  readonly id: string
  readonly preparation?: { readonly phase?: string }
}

export interface SpeechCatalogValue {
  readonly providers: readonly SpeechProvider[]
  /** How long one recording may run, in seconds. */
  readonly maxDurationSeconds: number
  readonly selection: { readonly providerId: string; readonly [key: string]: unknown }
  readonly maxAudioBytes: number
}

export interface SpeechAnswer<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

// The remote the DSH voice-input plugin mounts; only the members used here are declared.
export interface SpeechService {
  catalog(): Promise<SpeechAnswer<SpeechCatalogValue>>
  transcribe(request: { readonly audioBase64: string; readonly [key: string]: unknown }, signal?: AbortSignal): Promise<SpeechAnswer<{ readonly text?: string }>>
}

export interface SpeechCatalog {
  readonly catalog: SpeechCatalogValue
  readonly usable: boolean
}

export async function speechCatalog(speech: SpeechService): Promise<SpeechCatalog> {
  const result = await speech.catalog()
  if (!result.ok) throw new Error(result.error?.message ?? 'Speech catalog failed')
  const catalog = result.value as SpeechCatalogValue
  const provider = catalog.providers.find(item => item.id === catalog.selection.providerId)
  return { catalog, usable: USABLE.has(provider?.preparation?.phase ?? '') }
}

export function waveBytes(samples: ArrayLike<number>, rate = 16000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string): void => { for (let index = 0; index < text.length; index += 1) bytes[at + index] = text.charCodeAt(index) }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), true)
  }
  return bytes
}

export function base64Of(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

export interface CaptureError extends Error {
  readonly kind: string
  readonly cause?: unknown
}

const captureError = (kind: string, cause?: unknown): CaptureError => Object.assign(new Error(kind), { kind, cause })

// One microphone recording. level() reads the live loudness (0–1); finish() returns
// the WAV, or null when nothing was recorded; cancel() drops it.
export interface Capture {
  level(): number
  cancel(): void
  finish(maxSeconds: number): Promise<Uint8Array | null>
}

export async function openCapture(): Promise<Capture> {
  const devices: MediaDevices | undefined = navigator.mediaDevices
  if (!devices?.getUserMedia || typeof MediaRecorder === 'undefined') throw captureError('unavailable')
  let stream: MediaStream
  try {
    stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
  } catch (error) {
    throw captureError((error as { name?: string }).name === 'NotAllowedError' ? 'blocked' : 'failed', error)
  }
  const audio = new AudioContext()
  const analyser = audio.createAnalyser()
  analyser.fftSize = 512
  audio.createMediaStreamSource(stream).connect(analyser)
  const frame = new Float32Array(analyser.fftSize)
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event: BlobEvent) => { if (event.data.size > 0) chunks.push(event.data) }
  recorder.start()
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    if (recorder.state !== 'inactive') recorder.stop()
    stream.getTracks().forEach(track => track.stop())
    void audio.close().catch(() => {})
  }
  return {
    level(): number {
      if (closed) return 0
      analyser.getFloatTimeDomainData(frame)
      let sum = 0
      for (const sample of frame) sum += sample * sample
      return Math.min(1, Math.sqrt(sum / frame.length) * 4)
    },
    cancel: close,
    async finish(maxSeconds: number): Promise<Uint8Array | null> {
      if (closed || recorder.state === 'inactive') { close(); return null }
      try {
        await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop() })
        stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(chunks, { type: recorder.mimeType })
        if (blob.size === 0) return null
        const decoded = await audio.decodeAudioData(await blob.arrayBuffer())
        const length = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * 16000))
        const offline = new OfflineAudioContext(1, length, 16000)
        const source = offline.createBufferSource()
        source.buffer = decoded
        source.connect(offline.destination)
        source.start()
        return waveBytes((await offline.startRendering()).getChannelData(0))
      } finally { close() }
    },
  }
}

export async function transcribeWave(speech: SpeechService, catalog: SpeechCatalogValue, wave: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (wave.byteLength > catalog.maxAudioBytes) throw captureError('too-long')
  const result = await speech.transcribe({ audioBase64: base64Of(wave), ...catalog.selection }, signal)
  if (!result.ok) throw Object.assign(new Error(result.error?.message ?? 'Transcription failed'), { kind: 'service' })
  return String(result.value?.text ?? '').trim()
}

export type Turn = 'speech' | 'waiting' | 'done'

export interface TurnDetectorOptions {
  readonly loud?: number
  readonly quiet?: number
  readonly quietMs?: number
}

// Voice activity on the loudness of each animation frame: speech starts above
// `loud`, and the turn ends after `quietMs` below `quiet`.
export function turnDetector({ loud = 0.12, quiet = 0.06, quietMs = 1200 }: TurnDetectorOptions = {}): (level: number, now: number) => Turn {
  let spokeAt = 0
  let quietSince = 0
  return (level: number, now: number): Turn => {
    if (level >= loud) { spokeAt ||= now; quietSince = 0; return 'speech' }
    if (!spokeAt) return 'waiting'
    if (level < quiet) quietSince ||= now
    return quietSince && now - quietSince >= quietMs ? 'done' : 'speech'
  }
}
