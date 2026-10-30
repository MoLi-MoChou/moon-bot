// A blank team chat: who is on the other side and how to start, over the composer.
// The shell marks a Session without turns as its hero phase; the welcome shows only
// there (see the CSS), so it leaves as soon as the first message is in. A chat that
// carries on from earlier parts is not new, and gets no welcome.
import { createElement as h } from 'react';
import { BotAvatar, RoomAvatar } from './mark.tsx';
import { isMainOf } from './sources.ts';
import type { Roster } from './sources.ts';
import { EmptyState } from 'moon-bot-ui';
import { t } from './i18n.ts';
export interface WelcomeCopy {
    readonly title: string;
    readonly hint: string;
}
// The roster holds the Bot/Room records as plain objects (team state comes from the host).
interface WelcomeBot {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
    readonly parts?: readonly string[];
}
interface WelcomeRoom {
    readonly id: string;
    readonly name: string;
    readonly parts?: readonly string[];
}
export function welcomeCopy(roster: Roster, sessionId: string): WelcomeCopy | null {
    const bot = roster.byId?.[sessionId] as WelcomeBot | undefined;
    if (bot) {
        if ((bot.parts ?? []).length > 0)
            return null;
        if (isMainOf(roster, bot.id)) {
            return { title: t('Hi, I’m {name}', { name: bot.name }), hint: t('I lead your Bot team. Tell me what you need, or ask me to set up a Bot for a job.') };
        }
        return {
            title: t('Start a chat with {name}', { name: bot.name }),
            hint: bot.role ? t('{role}. Tell {name} what you need; the work stays in this chat.', { role: bot.role, name: bot.name }) : t('Tell {name} what you need; the work stays in this chat.', { name: bot.name }),
        };
    }
    const room = roster.roomsById?.[sessionId] as WelcomeRoom | undefined;
    if (room && (room.parts ?? []).length === 0) {
        return { title: t('Welcome to {name}', { name: room.name }), hint: t('Write to everyone here, or call one member with @Name.') };
    }
    return null;
}
interface ChatWelcomeProps {
    readonly sessionId: string;
    readonly useRoster: <T>(select: (roster: Roster) => T) => T;
}
export function ChatWelcome({ sessionId, useRoster }: ChatWelcomeProps) {
    const roster = useRoster(value => value);
    const copy = welcomeCopy(roster, sessionId);
    if (!copy)
        return null;
    const bot = roster.byId?.[sessionId] as WelcomeBot | undefined;
    const art = bot
        ? <BotAvatar bot={bot} size={56} main={isMainOf(roster, bot.id)} admin={false} badge={false} />
        : <RoomAvatar room={roster.roomsById[sessionId] as unknown as {
                members: readonly string[];
            }} roster={roster} size={56} />;
    return <div className='bt-welcome'><EmptyState art={art} title={copy.title} hint={copy.hint} /></div>;
}
export const WELCOME_CSS = `
.bt-welcome{display:none;padding:0 23px 12px}
[data-content-phase=hero] .bt-welcome{display:flex;justify-content:center}
.bt-welcome .bt-es{padding:12px 16px 20px}
`;
