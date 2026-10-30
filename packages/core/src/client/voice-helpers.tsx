import { useState, useEffect } from 'react'
import { stripHeader } from './text.ts'
import type { SpeechService } from './speech.ts'
import type { MarkBot } from './mark.tsx'

export interface VoiceRoom {
  readonly id: string
  readonly name: string
  readonly members: readonly string[]
}
export interface VoiceRoster {
  readonly byId: Record<
    string,
    | ({
        readonly name: string
      } & MarkBot)
    | undefined
  >
  readonly roomsById?: Record<string, VoiceRoom | undefined> | undefined
}
/** The turn outline a Session projects: its last entry is the reply being read aloud. */
export interface TurnOutlineEntry {
  readonly response?: string | undefined
}
export interface SessionListEntryView {
  readonly projectionValues?:
    | {
        readonly turnOutline?: readonly TurnOutlineEntry[] | undefined
      }
    | undefined
}
export interface SessionList {
  readonly byId: Record<string, SessionListEntryView | undefined>
  readonly projectionsBySession?:
    | Record<
        string,
        | {
            readonly values?:
              | {
                  readonly turnOutline?: readonly TurnOutlineEntry[] | undefined
                }
              | undefined
          }
        | undefined
      >
    | undefined
}
export type StoreHook<T> = <R>(select: (state: T) => R) => R
export interface VoiceActions {
  speech: () => SpeechService | null
  closeVoice: () => void
  voiceSetup: () => void
  send: (sessionId: string, text: string) => Promise<unknown>
}
// Voice chat: listen, send what the user said, read the Bot's answer aloud, listen
// again. With the host's Voice Input plugin on, its recognizer hears the user: one
// recording ends after a pause and is transcribed whole. Otherwise the browser's
// own speech recognition does. The browser's speech synthesis reads the answer.
export const plainSpeech = (text: string): string =>
  stripHeader(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
export const VOICE_LABELS: Record<string, string> = {
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  paused: 'Paused',
  setup: 'Voice input needs its speech model',
  unsupported: 'Voice chat is not available in this browser',
}
export const CAPTURE_NOTES: Record<string, string> = {
  blocked: 'Microphone access is blocked',
  unavailable: 'Voice chat is not available in this browser',
  'too-long': 'That was too long to recognize',
}
export function useMicLevel(enabled: boolean): number {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.getUserMedia) return undefined
    let stream: MediaStream | null = null
    let audio: AudioContext | null = null
    let frame = 0
    let stopped = false
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(media => {
        if (stopped) {
          media.getTracks().forEach(track => track.stop())
          return
        }
        stream = media
        audio = new AudioContext()
        const analyser = audio.createAnalyser()
        analyser.fftSize = 256
        audio.createMediaStreamSource(media).connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        let smooth = 0
        const tick = () => {
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (const value of data) sum += ((value - 128) / 128) ** 2
          smooth = smooth * 0.8 + Math.min(1, Math.sqrt(sum / data.length) * 4) * 0.2
          setLevel(Math.round(smooth * 100) / 100)
          frame = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => {})
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach(track => track.stop())
      void audio?.close().catch(() => {})
      setLevel(0)
    }
  }, [enabled])
  return level
}
