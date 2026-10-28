import { createElement as h, useEffect, useRef, useState } from 'react';
import { stripHeader } from './text.ts';
import { MicIcon, CloseIcon } from './icons.tsx';
import { BotMark, RoomAvatar } from './mark.tsx';
import { speechApi, useDictation } from './composer.tsx';
import { Shimmer } from './cells.ts';
import { useEscape, usePaneLeft } from './overlay-hooks.ts';
import { t } from './i18n.ts';
import { openCapture, speechCatalog, transcribeWave, turnDetector } from './speech.ts';
import type { Capture, SpeechCatalogValue, SpeechService } from './speech.ts';
import type { MarkBot } from './mark.tsx';
interface VoiceRoom {
    readonly id: string;
    readonly name: string;
    readonly members: readonly string[];
}
export interface VoiceRoster {
    readonly byId: Record<string, {
        readonly name: string;
    } & MarkBot | undefined>;
    readonly roomsById?: Record<string, VoiceRoom | undefined> | undefined;
}
/** The turn outline a Session projects: its last entry is the reply being read aloud. */
interface TurnOutlineEntry {
    readonly response?: string | undefined;
}
interface SessionListEntryView {
    readonly projectionValues?: {
        readonly turnOutline?: readonly TurnOutlineEntry[] | undefined;
    } | undefined;
}
interface SessionList {
    readonly byId: Record<string, SessionListEntryView | undefined>;
    readonly projectionsBySession?: Record<string, {
        readonly values?: {
            readonly turnOutline?: readonly TurnOutlineEntry[] | undefined;
        } | undefined;
    } | undefined> | undefined;
}
type StoreHook<T> = <R>(select: (state: T) => R) => R;
export interface VoiceActions {
    speech: () => SpeechService | null;
    closeVoice: () => void;
    voiceSetup: () => void;
    send: (sessionId: string, text: string) => Promise<unknown>;
}
// Voice chat: listen, send what the user said, read the Bot's answer aloud, listen
// again. With DSH's Voice Input plugin on, its recognizer hears the user: one
// recording ends after a pause and is transcribed whole. Otherwise the browser's
// own speech recognition does. The browser's speech synthesis reads the answer.
const plainSpeech = (text: string): string => stripHeader(text).replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>|~-]+/g, ' ').replace(/\s+/g, ' ').trim();
const VOICE_LABELS: Record<string, string> = {
    listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', paused: 'Paused',
    setup: 'Voice input needs its speech model', unsupported: 'Voice chat is not available in this browser',
};
const CAPTURE_NOTES: Record<string, string> = { blocked: 'Microphone access is blocked', unavailable: 'Voice chat is not available in this browser', 'too-long': 'That was too long to recognize' };
function useMicLevel(enabled: boolean): number {
    const [level, setLevel] = useState(0);
    useEffect(() => {
        if (!enabled || !navigator.mediaDevices?.getUserMedia)
            return undefined;
        let stream: MediaStream | null = null;
        let audio: AudioContext | null = null;
        let frame = 0;
        let stopped = false;
        navigator.mediaDevices.getUserMedia({ audio: true }).then((media) => {
            if (stopped) {
                media.getTracks().forEach(track => track.stop());
                return;
            }
            stream = media;
            audio = new AudioContext();
            const analyser = audio.createAnalyser();
            analyser.fftSize = 256;
            audio.createMediaStreamSource(media).connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            let smooth = 0;
            const tick = () => {
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (const value of data)
                    sum += ((value - 128) / 128) ** 2;
                smooth = smooth * 0.8 + Math.min(1, Math.sqrt(sum / data.length) * 4) * 0.2;
                setLevel(Math.round(smooth * 100) / 100);
                frame = requestAnimationFrame(tick);
            };
            tick();
        }).catch(() => { });
        return () => {
            stopped = true;
            cancelAnimationFrame(frame);
            stream?.getTracks().forEach(track => track.stop());
            void audio?.close().catch(() => { });
            setLevel(0);
        };
    }, [enabled]);
    return level;
}
export function VoiceMode({ sessionId, roster, actions, useSessions, useSessionStatus }: {
    sessionId: string;
    roster: VoiceRoster;
    actions: VoiceActions;
    useSessions: StoreHook<SessionList>;
    useSessionStatus: StoreHook<ReadonlyMap<string, {
        readonly running?: boolean | undefined;
    }>>;
}) {
    const bot = roster.byId[sessionId];
    const room = roster.roomsById?.[sessionId];
    const name = bot?.name ?? room?.name ?? t('Bot');
    const running = useSessionStatus(map => map.get(sessionId)?.running === true);
    const lastReply = useSessions((list) => {
        const outline = list.projectionsBySession?.[sessionId]?.values?.turnOutline ?? list.byId[sessionId]?.projectionValues?.turnOutline;
        const count = outline?.length ?? 0;
        const entry = outline === undefined ? undefined : outline[count - 1];
        return entry ? `${count}|${entry.response ?? ''}` : '0|';
    });
    // The Voice Input plugin's Remote, read once: the engine does not change mid-chat.
    const [speech] = useState(() => actions.speech());
    const [phase, setPhase] = useState<string>(speech ? 'starting' : speechApi() ? 'listening' : 'unsupported');
    const [catalog, setCatalog] = useState<SpeechCatalogValue | null>(null);
    const [heard, setHeard] = useState('');
    const [said, setSaid] = useState('');
    const [note, setNote] = useState('');
    const [serviceLevel, setServiceLevel] = useState(0);
    const [cycle, setCycle] = useState(0);
    const waiting = useRef<string | null>(null);
    const reply = useRef(lastReply);
    reply.current = lastReply;
    // Bumped on pause and close, so a transcript that arrives later is dropped.
    const turn = useRef(0);
    const paneLeft = usePaneLeft();
    const close = () => { turn.current += 1; window.speechSynthesis?.cancel(); actions.closeVoice(); };
    useEscape(close);
    const submit = (text: string): void => {
        setHeard(text);
        setPhase('thinking');
        waiting.current = reply.current.split('|')[0] as string;
        void actions.send(sessionId, text.trim()).catch(() => setPhase('listening'));
    };
    const dictation = useDictation((text, final) => {
        setHeard(text);
        if (!final)
            return;
        dictation.stop();
        submit(text);
    });
    useEffect(() => {
        if (!note)
            return undefined;
        const timer = setTimeout(() => setNote(''), 2600);
        return () => clearTimeout(timer);
    }, [note]);
    useEffect(() => {
        if (!speech)
            return undefined;
        let live = true;
        speechCatalog(speech).then(({ catalog: next, usable }) => {
            if (!live)
                return;
            setCatalog(next);
            setPhase(usable ? 'listening' : 'setup');
        }, () => { if (live)
            setPhase('setup'); });
        return () => { live = false; };
    }, [speech]);
    const listen = phase === 'listening';
    useEffect(() => {
        if (speech || !listen || dictation.listening)
            return undefined;
        const timer = setTimeout(() => dictation.start({ continuous: false, onEnd: () => { } }), 250);
        return () => clearTimeout(timer);
    }, [listen, dictation.listening]);
    // Recognition stops on silence; keep listening until the user pauses or ends.
    useEffect(() => {
        if (phase !== 'listening')
            dictation.stop();
    }, [phase]);
    // The plugin's recognizer: record one utterance, end it after a pause, transcribe it.
    useEffect(() => {
        if (!speech || !catalog || !listen)
            return undefined;
        const own = turn.current;
        let capture: Capture | null = null;
        let frame = 0;
        let stopped = false;
        let smooth = 0;
        const detect = turnDetector();
        const limit = Math.max(1, catalog.maxDurationSeconds - 1) * 1000;
        const finish = async (current: Capture): Promise<void> => {
            setPhase('transcribing');
            try {
                const wave = await current.finish(catalog.maxDurationSeconds);
                const text = wave ? await transcribeWave(speech, catalog, wave, new AbortController().signal) : '';
                if (turn.current !== own)
                    return;
                if (text)
                    submit(text);
                else
                    setPhase('listening');
            }
            catch (error) {
                if (turn.current !== own)
                    return;
                setNote(t(CAPTURE_NOTES[(error as {
                    readonly kind?: string;
                } | undefined)?.kind ?? ''] ?? "Couldn't hear that"));
                setPhase('listening');
            }
        };
        openCapture().then((opened) => {
            if (stopped) {
                opened.cancel();
                return;
            }
            capture = opened;
            const began = performance.now();
            const tick = (): void => {
                const now = performance.now();
                const level = opened.level();
                smooth = smooth * 0.8 + level * 0.2;
                setServiceLevel(Math.round(smooth * 100) / 100);
                const state = detect(level, now);
                if (state === 'done' || (state === 'speech' && now - began >= limit)) {
                    capture = null;
                    setServiceLevel(0);
                    void finish(opened);
                    return;
                }
                // Nothing said for a whole recording: start a fresh one.
                if (state === 'waiting' && now - began >= limit) {
                    setCycle(value => value + 1);
                    return;
                }
                frame = requestAnimationFrame(tick);
            };
            tick();
        }, (error) => {
            if (stopped)
                return;
            setNote(t(CAPTURE_NOTES[error?.kind] ?? "Couldn't hear that"));
            setPhase('paused');
        });
        return () => {
            stopped = true;
            cancelAnimationFrame(frame);
            capture?.cancel();
            setServiceLevel(0);
        };
    }, [speech, catalog, listen, cycle]);
    useEffect(() => {
        if (phase !== 'thinking' || running || waiting.current === null)
            return;
        const [count, text] = [lastReply.slice(0, lastReply.indexOf('|')), lastReply.slice(lastReply.indexOf('|') + 1)];
        if (count === waiting.current || !text.trim())
            return;
        waiting.current = null;
        const spoken = plainSpeech(text);
        setSaid(spoken);
        setHeard('');
        if (!window.speechSynthesis || !spoken) {
            setPhase('listening');
            return;
        }
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.lang = /[\u3400-\u9fff]/.test(spoken) ? 'zh-CN' : 'en-US';
        utterance.onend = () => setPhase(current => (current === 'speaking' ? 'listening' : current));
        utterance.onerror = utterance.onend;
        setPhase('speaking');
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }, [phase, running, lastReply]);
    useEffect(() => () => window.speechSynthesis?.cancel(), []);
    const micLevel = useMicLevel(!speech && phase === 'listening' && dictation.listening);
    const level = speech ? serviceLevel : micLevel;
    const markState = phase === 'thinking' || phase === 'transcribing' ? 'thinking' : phase === 'speaking' ? 'sending' : 'idle';
    const blocked = phase === 'unsupported' || phase === 'setup' || phase === 'starting';
    const togglePause = () => {
        if (phase === 'paused') {
            setPhase('listening');
            return;
        }
        turn.current += 1;
        window.speechSynthesis?.cancel();
        setPhase('paused');
    };
    const openSetup = phase === 'setup' ? actions.voiceSetup : null;
    const caption = phase === 'speaking' ? said : heard;
    const shownNote = note || dictation.note;
    return <div className='bt-pane bt-voice-pane' style={{ left: paneLeft }}><div className='bt-voice-stage' role='dialog' aria-label={t('Voice chat with {name}', { name })} data-phase={phase === 'transcribing' ? 'thinking' : phase}><div className='bt-voice-orb' style={{ '--bt-level': level }}><span className='bt-voice-ring' aria-hidden/><span className='bt-voice-ring bt-voice-ring-2' aria-hidden/>{bot ? <BotMark bot={bot} size={112} state={markState} live gaze={phase === 'listening'} /> : room ? <RoomAvatar room={room} roster={roster} size={112} /> : null}</div><div className='bt-voice-name'>{name}</div><div className='bt-voice-status' role='status'>{phase === 'thinking' ? <Shimmer>{t('Thinking…')}</Shimmer>
        : phase === 'transcribing' ? <Shimmer>{t('Recognizing…')}</Shimmer>
            : VOICE_LABELS[phase] ? t(VOICE_LABELS[phase]) : ''}</div><div className='bt-voice-caption' key={`${phase}:${caption.slice(0, 12)}`}>{caption}</div>{openSetup ? <button type='button' className='bt-voice-setup' onClick={() => { close(); openSetup(); }}>{t('Set up voice input')}</button> : null}{shownNote ? <div className='bt-voice-note'>{shownNote}</div> : null}</div><div className='bt-voice-bar'><button type='button' className='bt-voice-btn' aria-pressed={phase === 'paused'} disabled={blocked} aria-label={phase === 'paused' ? t('Resume listening') : t('Pause')} onClick={togglePause}><MicIcon size={20} />{phase === 'paused' ? <span className='bt-voice-slash' aria-hidden/> : null}</button><button type='button' className='bt-voice-btn bt-voice-end' aria-label={t('End voice chat')} onClick={close}><CloseIcon /></button></div></div>;
}
