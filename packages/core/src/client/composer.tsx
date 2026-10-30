import { Fragment, createElement as h, useEffect, useRef, useState } from 'react';
import { LEAN } from './lean.ts';
import { createPortal } from 'react-dom';
import { ChatsIcon, ClockIcon, MicIcon, PaperclipIcon, PeopleIcon, PlusIcon, WaveIcon } from './icons.tsx';
import { BotMark } from './mark.tsx';
import { MENU_EXIT_MS, useLinger } from './motion.tsx';
import { useEscape, useMenuKeys } from './overlay-hooks.ts';
import { t } from './i18n.ts';
// -------------------------------------------------------------------------
// Composer: dictation mic and the voice-chat button. The shell's send
// button stays the submit path; CSS swaps it with the voice button while the draft is
// empty (the send button is disabled then).
export const speechApi = (): SpeechRecognitionCtor | undefined => window.SpeechRecognition ?? window.webkitSpeechRecognition;
const keepComposerFocus = (event: {
    preventDefault: () => void;
}): void => event.preventDefault();
// The roster fields the "+" menu reads: a chat's Bot or group.
export interface ComposerRoster {
    byId?: Record<string, {
        id: string;
        name: string;
    } | undefined>;
    roomsById?: Record<string, {
        id: string;
        name: string;
    } | undefined>;
}
export interface Dictation {
    listening: boolean;
    note: string;
    start: (options?: {
        continuous?: boolean;
        onEnd?: () => void;
    }) => boolean;
    stop: () => void;
}
export function useDictation(onText: (text: string, final: boolean) => void): Dictation {
    const [listening, setListening] = useState(false);
    const [note, setNote] = useState('');
    const recognition = useRef<SpeechRecognitionLike | null>(null);
    const latest = useRef(onText);
    latest.current = onText;
    useEffect(() => () => recognition.current?.abort(), []);
    useEffect(() => {
        if (!note)
            return undefined;
        const timer = setTimeout(() => setNote(''), 2600);
        return () => clearTimeout(timer);
    }, [note]);
    const start = ({ continuous = true, onEnd }: {
        continuous?: boolean;
        onEnd?: () => void;
    } = {}): boolean => {
        const Api = speechApi();
        if (!Api) {
            setNote(t('Dictation is not available in this browser'));
            return false;
        }
        const engine = new Api();
        engine.lang = navigator.language || 'zh-CN';
        engine.interimResults = true;
        engine.continuous = continuous;
        engine.onresult = (event: SpeechRecognitionEventLike) => {
            let interim = '';
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                if (result === undefined)
                    continue;
                const text = result[0]?.transcript ?? '';
                if (result.isFinal) {
                    if (text.trim())
                        latest.current(text, true);
                }
                else
                    interim += text;
            }
            if (interim)
                latest.current(interim, false);
        };
        engine.onerror = (event: SpeechRecognitionErrorLike) => {
            if (event.error === 'aborted' || event.error === 'no-speech')
                return;
            setNote(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? t('Microphone access is blocked') : t("Couldn't hear that"));
        };
        engine.onend = () => { setListening(false); recognition.current = null; onEnd?.(); };
        recognition.current = engine;
        try {
            engine.start();
            setListening(true);
            return true;
        }
        catch {
            setNote(t("Couldn't start dictation"));
            return false;
        }
    };
    const stop = () => recognition.current?.stop();
    return { listening, note, start, stop };
}
export function ComposerVoice({ sessionId, inputActions, actions, useUi }: {
    sessionId: string | undefined;
    inputActions: {
        insertText: (text: string, insertion: unknown) => void;
        captureInsertion: () => unknown;
    } | undefined;
    actions: {
        clearQuote: (token: number) => void;
        speech: () => unknown;
        openVoice: (id: string) => void;
    };
    useUi: <T>(select: (state: {
        quote?: {
            sessionId: string;
            text: string;
            token: number;
        } | null | undefined;
    }) => T) => T;
}) {
    const dictation = useDictation((text, final) => {
        if (final && inputActions)
            inputActions.insertText(text, inputActions.captureInsertion());
    });
    // Reply from a message's hover toolbar quotes it into this composer.
    const quote = useUi(state => (state.quote?.sessionId === sessionId ? state.quote ?? null : null));
    useEffect(() => {
        if (!quote || !inputActions)
            return;
        actions.clearQuote(quote.token);
        const excerpt = quote.text.replace(/\s+/g, ' ').trim();
        const line = `> ${excerpt.length > 200 ? `${excerpt.slice(0, 200)}…` : excerpt}\n\n`;
        inputActions.insertText(line, inputActions.captureInsertion());
        const box = document.querySelector('[class*="_centerCol"] [role=textbox][contenteditable=true]');
        if (box instanceof HTMLElement) {
            box.focus();
            const selection = window.getSelection();
            selection?.selectAllChildren(box);
            selection?.collapseToEnd();
        }
    }, [quote?.token]);
    if (sessionId === undefined)
        return null;
    // With the Voice Input plugin on, its own microphone sits in this composer.
    const pluginMic = actions.speech() !== undefined;
    return <>{pluginMic ? null : <button type='button' className='bt-mic' aria-label={dictation.listening ? t('Stop dictation') : t('Dictate')} aria-pressed={dictation.listening} title={dictation.listening ? t('Stop dictation') : t('Dictate')} onMouseDown={keepComposerFocus} onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}><MicIcon /></button>}<button type='button' className='bt-voice' aria-label={t('Start voice chat')} title={t('Voice chat')} onMouseDown={keepComposerFocus} onClick={() => actions.openVoice(sessionId)}><WaveIcon size={18} /></button>{dictation.note ? <span className='bt-mic-note' role='status'>{dictation.note}</span> : null}</>;
}
// Character marks for the "@" menu rows. Each Bot keeps one component, so the menu
// does not remount its mark on every keystroke.
export function menuIcons(roster: {
    getSnapshot: () => {
        byId: Record<string, {
            id: string;
        } | undefined>;
    };
}) {
    const marks = new Map<string, (props: {
        size?: number;
    }) => ReturnType<typeof h>>();
    return (row: {
        bot?: {
            id: string;
        };
    }) => {
        if (!row.bot)
            return PeopleIcon;
        const id = row.bot.id;
        if (!marks.has(id))
            marks.set(id, ({ size = 14 }) => <BotMark bot={roster.getSnapshot().byId[id] ?? row.bot} size={size} />);
        return marks.get(id);
    };
}
// The composer's "+" in a Bot's chat or a group chat: add files, reference another
// chat, or set a scheduled task for this chat. It stands in for the shell's command
// menu, whose plan, permission, model and compact rows reach past what DS Bot keeps
// for its Bots; "/" still opens that menu. Files go through the shell's own file
// input beside it.
export function ComposerPlus({ sessionId, inputActions, useRoster, actions }: {
    sessionId: string | undefined;
    inputActions: {
        captureInsertion?: () => unknown;
    } | undefined;
    useRoster: <T>(select: (value: ComposerRoster) => T) => T;
    actions: {
        openSettings: (page: string, id: string) => void;
        referenceChat: (sessionId: string, insertion: unknown) => void;
        canReferenceChat: () => boolean;
    };
}) {
    const roster = useRoster(value => value);
    const [open, setOpen] = useState<{
        left: number;
        bottom: number;
        files: boolean;
    } | null>(null);
    const [shown, leaving] = useLinger(open, MENU_EXIT_MS);
    const button = useRef<HTMLButtonElement | null>(null);
    const menu = useRef<HTMLDivElement | null>(null);
    useMenuKeys(menu, Boolean(open));
    useEscape(() => { setOpen(null); button.current?.focus(); }, Boolean(open));
    useEffect(() => {
        if (!open)
            return undefined;
        const onDown = (event: MouseEvent) => { const target = event.target as Node | null; if (![button.current, menu.current].some(node => node?.contains(target)))
            setOpen(null); };
        window.addEventListener('mousedown', onDown, true);
        return () => { window.removeEventListener('mousedown', onDown, true); };
    }, [open]);
    const target = sessionId === undefined ? undefined : roster.byId?.[sessionId]?.id ?? roster.roomsById?.[sessionId]?.id;
    if (sessionId === undefined || target === undefined)
        return null;
    const fileInput = () => button.current?.closest('[data-composer-card]')?.querySelector<HTMLInputElement>('input[type=file]');
    const toggle = () => {
        if (open) {
            setOpen(null);
            return;
        }
        const node = button.current;
        if (node === null)
            return;
        const rect = node.getBoundingClientRect();
        // Files go through the composer's own file input; a composer without one takes none.
        setOpen({ left: rect.left, bottom: window.innerHeight - rect.top + 8, files: Boolean(fileInput()) });
    };
    const attach = () => {
        setOpen(null);
        fileInput()?.click();
    };
    const schedule = () => {
        setOpen(null);
        actions.openSettings('schedules', target);
    };
    // The chats open in the shell's "@" menu at the caret, so the pick lands where the
    // user was typing.
    const reference = () => {
        setOpen(null);
        actions.referenceChat(sessionId, inputActions?.captureInsertion?.());
    };
    const canReference = typeof inputActions?.captureInsertion === 'function' && actions.canReferenceChat();
    return <><button ref={button} type='button' className='bt-plus' aria-label={t('Add')} title={t('Add')} aria-haspopup='menu' aria-expanded={Boolean(open)} onMouseDown={keepComposerFocus} onClick={toggle}><PlusIcon /></button>{shown ? createPortal(<div ref={menu} className='bt-menu bt-menu-up bt-plus-menu' role='menu' aria-label={t('Add')} style={{ left: shown.left, bottom: shown.bottom }} data-leaving={leaving || undefined}>{shown.files ? <button type='button' role='menuitem' onClick={attach}><PaperclipIcon /><span className='bt-menu-label'>{t('Add files')}</span></button> : null}{canReference ? <button type='button' role='menuitem' onMouseDown={keepComposerFocus} onClick={reference}><ChatsIcon /><span className='bt-menu-label'>{t('Reference a chat')}</span></button> : null}{LEAN.schedules ? <button type='button' role='menuitem' onClick={schedule}><ClockIcon /><span className='bt-menu-label'>{t('Scheduled task')}</span></button> : null}</div>, document.body) : null}</>;
}
