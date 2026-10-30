// Settings → Library: every file the team's turns delivered, across chats. Each row
// opens the same preview a chat card does and can jump back to the chat that made it;
// paths stay workspace-relative, as the host reports them.
import { createElement as h, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { call } from './api.ts';
import { EmptyState } from './kit/index.ts';
import { FileKindIcon, LibraryIcon, ReplyIcon } from './icons.tsx';
import { FilePreview, KIND_LABELS, fileKind, timeBucket } from './deliver-cards.tsx';
import type { LibraryItem } from './deliver-cards.tsx';
import { formatBytes, typeLabel } from './files-panel.ts';
import { dateLocale, t } from './i18n.ts';

interface LibraryBot {
    readonly id: string;
    readonly name: string;
}
interface LibraryRoom {
    readonly id: string;
    readonly name: string;
}
interface LibraryRoster {
    readonly byId: Record<string, LibraryBot | undefined>;
    readonly roomsById: Record<string, LibraryRoom | undefined>;
}
interface LibraryActions {
    openSession: (id: string) => void;
}

const TIME_FILTERS: readonly (readonly ['today' | 'week' | 'earlier' | 'all', string])[] = [
    ['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['earlier', 'Earlier'],
];
const whenLabel = (at: number): string => new Date(at).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });

export function LibraryPage({ roster, actions }: {
    roster: LibraryRoster;
    actions: LibraryActions;
}) {
    const [items, setItems] = useState<readonly LibraryItem[] | null>(null);
    const [problem, setProblem] = useState('');
    const [owner, setOwner] = useState('all');
    const [kind, setKind] = useState('all');
    const [age, setAge] = useState('all');
    const [preview, setPreview] = useState<LibraryItem | null>(null);
    useEffect(() => {
        let stopped = false;
        call<{ readonly items?: readonly LibraryItem[] }>('library')
            .then(answer => {
                if (!stopped)
                    setItems(answer?.items ?? []);
            })
            .catch(failure => {
                if (!stopped) {
                    setItems([]);
                    setProblem(failure instanceof Error ? failure.message : String(failure));
                }
            });
        return () => {
            stopped = true;
        };
    }, []);
    // The Bots worth filtering by are the ones with a file on the shelf.
    const owners: LibraryBot[] = [];
    for (const item of items ?? []) {
        const bot = item.ownerId === null ? undefined : roster.byId[item.ownerId];
        if (bot && !owners.some(entry => entry.id === bot.id))
            owners.push(bot);
    }
    const shown = (items ?? []).filter(item => (owner === 'all' || roster.byId[item.ownerId ?? '']?.id === owner || item.sessionId === owner)
        && (kind === 'all' || fileKind(item.name) === kind)
        && (age === 'all' || timeBucket(item.createdAt) === age));
    const clearFilters = (): void => {
        setOwner('all');
        setKind('all');
        setAge('all');
    };
    const hasShelf = (items?.length ?? 0) > 0;
    return <div className='bt-library'>
        {hasShelf ? <div className='bt-lib-filters'>
            <select className='bt-select' aria-label={t('Filter by Bot')} value={owner} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setOwner(event.target.value)}>
                <option value='all'>{t('All')}</option>
                {owners.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
            </select>
            <select className='bt-select' aria-label={t('Filter by type')} value={kind} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setKind(event.target.value)}>
                <option value='all'>{t('All')}</option>
                {KIND_LABELS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
            <select className='bt-select' aria-label={t('Filter by time')} value={age} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setAge(event.target.value)}>
                {TIME_FILTERS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
        </div> : null}
        {problem !== '' ? <div className='bt-error' role='alert'>{problem}</div> : null}
        {items === null ? <div className='bt-set-hint'>{t('Loading…')}</div>
            : items.length === 0 ? <EmptyState icon={<LibraryIcon />} title={t('No delivered files yet.')} hint={t('Files Bots deliver in their chats are kept here.')} />
                : shown.length === 0 ? <EmptyState icon={<LibraryIcon />} title={t('No files match these filters.')} action={{ label: t('Clear filters'), onClick: clearFilters }} />
                    : shown.map(item => <div key={`${item.sessionId}:${item.turn ?? ''}:${item.path}`} className='bt-lib-row'>
                        <button type='button' className='bt-lib-open' title={item.path} onClick={() => setPreview(item)}>
                            <span className='bt-dcard-icon' aria-hidden><FileKindIcon kind={fileKind(item.name)} /></span>
                            <span className='bt-lib-copy'>
                                <span className='bt-lib-name'>{item.name}</span>
                                <span className='bt-lib-meta'>{[roster.byId[item.ownerId ?? '']?.name ?? roster.roomsById[item.sessionId]?.name ?? t('a Bot'), formatBytes(item.size), typeLabel(item.name), item.path, whenLabel(item.createdAt)].filter(Boolean).join(' · ')}</span>
                            </span>
                        </button>
                        <button type='button' className='bt-soft bt-soft-sm bt-with-icon bt-lib-back' title={t('Back to chat')} aria-label={t('Back to chat')} onClick={() => actions.openSession(item.sessionId)}><ReplyIcon /><span className='bt-lib-back-label'>{t('Back to chat')}</span></button>
                    </div>)}
        {preview ? createPortal(<FilePreview file={preview} sessionId={preview.sessionId} onClose={() => setPreview(null)} />, document.body) : null}
    </div>;
}
