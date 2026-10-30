import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { inkText } from './inks.ts';
import { dayLabel } from './text.ts';
import { colorOf, BotMark } from './mark.tsx';
import { Bubbles } from './cells.ts';
import { stripLongNote } from './fold.tsx';
import { ChatsIcon } from './icons.tsx';
import { SHEET_EXIT_MS, reducedMotion } from './motion.tsx';
import { useEscape, usePaneLeft } from './overlay-hooks.ts';
import { EmptyState } from 'moon-bot-ui';
import { t } from './i18n.ts';
// One message the two Bots sent each other; a long one carries its length so the rest
// can be read on request.
export interface ExchangeEntry {
    id: string;
    from: string;
    text: string;
    time: number;
    length?: number;
}
interface ExchangeBot {
    id: string;
    name: string;
    color?: string;
}
export interface ExchangeActions {
    closeOverlay: () => void;
    exchange: (left: string, right: string) => Promise<ExchangeEntry[] | null | undefined>;
    exchangeText: (id: string) => Promise<string>;
}
export function ExchangeDialog({ pair, roster, actions }: {
    pair: readonly [
        string,
        string
    ];
    roster: {
        byId: Record<string, ExchangeBot | undefined>;
    };
    actions: ExchangeActions;
}) {
    const [entries, setEntries] = useState<ExchangeEntry[] | null>(null);
    const [leaving, setLeaving] = useState(false);
    const log = useRef<HTMLDivElement | null>(null);
    const atEnd = useRef(true);
    useLayoutEffect(() => {
        if (entries !== null && atEnd.current && log.current)
            log.current.scrollTop = log.current.scrollHeight;
    }, [entries]);
    // The sheet slides back down before it unmounts.
    const close = () => {
        if (leaving)
            return;
        setLeaving(true);
        setTimeout(() => actions.closeOverlay(), reducedMotion() ? 0 : SHEET_EXIT_MS);
    };
    useEscape(close);
    useEffect(() => {
        let stop = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let seen: string | null = null;
        atEnd.current = true;
        setEntries(null);
        const load = async (): Promise<void> => {
            const result = await actions.exchange(pair[0], pair[1]);
            if (stop)
                return;
            const key = JSON.stringify(result ?? []);
            if (key !== seen) {
                seen = key;
                setEntries(result ?? []);
            }
            timer = setTimeout(load, document.hidden ? 8000 : 2000);
        };
        void load();
        return () => { stop = true; clearTimeout(timer); };
    }, [pair[0], pair[1]]);
    const left = roster.byId[pair[0]];
    const right = roster.byId[pair[1]];
    let lastDay = 0;
    const paneLeft = usePaneLeft();
    return <div className='bt-pane bt-exchange' style={{ left: paneLeft }} data-leaving={leaving || undefined}><div className='bt-dialog' role='dialog' aria-label={t('Bot exchange')}><div className='bt-head'><span className='bt-pill' style={{ cursor: 'default' }}>{left ? <BotMark bot={left} size={22} /> : null}{left?.name ?? '?'}<span className='bt-swap'>⇄</span>{right ? <BotMark bot={right} size={22} /> : null}{right?.name ?? '?'}</span></div><div ref={log} className='bt-dialog-log' role='log' aria-label={t('Bot exchange transcript')} onScroll={(event: React.UIEvent<HTMLDivElement>) => {
        const node = event.currentTarget;
        atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 2;
    }}>{entries === null ? <div className='bt-hint'>{t('Loading…')}</div> : entries.length === 0 ? <EmptyState icon={<ChatsIcon />} title={t('No messages yet')} hint={t('Messages these Bots send each other show up here.')} />
        : entries.map((entry) => {
            const bot: ExchangeBot = roster.byId[entry.from] ?? { id: entry.from, name: String(t('You')), color: 'gray' };
            const showDay = entry.time - lastDay > 30 * 60 * 1000;
            lastDay = entry.time;
            // A long message comes with its start only; the rest is read on request.
            const whole = entry.length === undefined ? undefined : { length: entry.length, load: () => actions.exchangeText(entry.id) };
            // The dialog reads only its own fields of the roster and actions it is handed;
            // Bubbles takes the same full ones the rest of the client passes.
            const bubbles = { texts: [stripLongNote(entry.text)], roster, selfId: bot.id, actions, whole, lead: <span className='bt-lead'><BotMark bot={bot} size={22} /></span> } as unknown as Parameters<typeof Bubbles>[0];
            return <>{showDay ? <time className='bt-time'>{dayLabel(entry.time)}</time> : null}<div className='bt-group-msg'><span className='bt-group-name' style={{ color: inkText(colorOf(bot)) }}>{bot.name}</span><Bubbles {...bubbles} /></div></>;
        })}</div><div className='bt-dialog-foot'><button type='button' className='bt-soft' onClick={close}>{t('Close Chat')}</button></div></div></div>;
}
