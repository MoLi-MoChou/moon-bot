import { Fragment, createElement as h, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, FolderIcon, PencilIcon } from './icons.tsx';
import { Caret, useAnchoredMenu } from './model-menu.tsx';
import { t } from './i18n.ts';
// The last segment of a host path, Windows or POSIX; a root keeps its own spelling.
export const folderName = (path: string): string => String(path).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(path);
// A folder the host already knows about: a project, or the saved one.
export interface FolderEntry {
    path: string;
    title?: string;
}
// What the host offers for the picker: the team folder, which picker it can open, and
// the folders a Bot can be pointed at.
export interface FolderOffer {
    team: string | null;
    picker: string | null;
    folders: FolderEntry[];
}
export interface BrowseEntry {
    path: string;
    name: string;
    hidden?: boolean;
}
export interface FolderListing {
    path: string;
    crumbs?: {
        path: string;
    }[];
    entries?: BrowseEntry[];
    truncated?: boolean;
}
export interface FolderMenuActions {
    folders: () => Promise<FolderOffer | null | undefined>;
    folderList: (path: string) => Promise<FolderListing>;
    folderPick: () => Promise<string | undefined>;
}
export interface FolderMenuProps {
    value: string | undefined;
    group?: boolean;
    team?: boolean;
    actions: FolderMenuActions;
    run: (work: Promise<unknown>) => unknown;
    onPick: (path: string) => unknown;
    wide?: boolean;
    disabled?: boolean;
}
const Tick = ({ on }: {
    on: boolean;
}) => <span className='bt-model-tick' aria-hidden>{on ? <CheckIcon /> : null}</span>;
// Where a Bot, or every member of a group, works. `value` is the saved folder; without
// one a Bot works in the team workspace and a group member in its own folder. `onPick`
// gets the chosen path, or '' for that default. `team` is the menu for the team workspace
// itself, which has no default.
export function FolderMenu({ value, group = false, team = false, actions, run, onPick, wide = false, disabled = false }: FolderMenuProps) {
    const [info, setInfo] = useState<FolderOffer | null>(null);
    const [view, setView] = useState<'list' | 'type' | 'browse'>('list');
    const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu(() => {
        if (view !== 'list') {
            setView('list');
            return true;
        }
        return false;
    });
    const [draft, setDraft] = useState('');
    const [listing, setListing] = useState<FolderListing | null>(null);
    const [problem, setProblem] = useState('');
    const fallback = group ? String(t("Each Bot's own folder")) : String(t('Team workspace'));
    const toggle = (): void => {
        if (isOpen) {
            close();
            return;
        }
        setView('list');
        setProblem('');
        // Projects added in the host meanwhile show up, so opening asks again.
        void Promise.resolve(actions.folders()).then(next => setInfo(next ?? null)).catch(() => setInfo(last => last ?? { team: null, picker: null, folders: [] }));
        open();
    };
    const choose = (path: string): void => {
        close();
        if (path !== (value ?? ''))
            void onPick(path);
    };
    const browse = (path: string): void => {
        setProblem('');
        void Promise.resolve(actions.folderList(path)).then((next) => { setListing(next); setView('browse'); })
            .catch(failure => setProblem(failure?.message ?? String(failure)));
    };
    const pickNative = (): void => {
        close();
        void run(Promise.resolve(actions.folderPick()).then(path => (path ? onPick(path) : undefined)));
    };
    const typed = (): void => {
        const path = draft.trim();
        if (path !== '')
            choose(path);
    };
    const known = info?.folders ?? [];
    const folders = value && !known.some(folder => folder.path === value) ? [{ path: value, title: folderName(value) }, ...known] : known;
    const listView = <div key='list' className='bt-folder-view'>{team ? null : <button type='button' role='menuitemradio' aria-checked={!value} title={group ? undefined : info?.team ?? undefined} onClick={() => choose('')}><span className='bt-menu-label'>{fallback}</span><Tick on={!value} /></button>}{folders.length > 0 ? <div className='bt-model-group' role='presentation'>{t('Folders')}</div> : null}{folders.map(folder => <button key={folder.path} type='button' role='menuitemradio' aria-checked={folder.path === value} title={folder.path} onClick={() => choose(folder.path)}><span className='bt-folder-copy'><span className='bt-menu-label'>{folder.title}</span><span className='bt-folder-path'>{folder.path}</span></span><Tick on={folder.path === value} /></button>)}<div className='bt-menu-sep' role='separator'/>{info?.picker === 'native' ? <button type='button' role='menuitem' onClick={pickNative}><FolderIcon /><span className='bt-menu-label'>{t('Choose a folder…')}</span></button> : null}{info?.picker === 'browse' ? <button type='button' role='menuitem' onClick={() => browse(value ?? '')}><FolderIcon /><span className='bt-menu-label'>{t('Browse folders…')}</span></button> : null}<button type='button' role='menuitem' onClick={() => { setDraft(value ?? ''); setView('type'); }}><PencilIcon /><span className='bt-menu-label'>{t('Enter a path…')}</span></button></div>;
    const typeView = <div key='type' className='bt-folder-view'><button type='button' role='menuitem' className='bt-folder-back' onClick={() => setView('list')}><ChevronLeftIcon /><span className='bt-menu-label'>{t('Back')}</span></button><input className='bt-folder-input' autoFocus value={draft} spellCheck={false} aria-label={t('Folder path')} placeholder={t('Full path of a folder')} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing)
        typed(); }}/><button type='button' role='menuitem' className='bt-folder-use' disabled={draft.trim() === ''} onClick={typed}>{t('Use this folder')}</button></div>;
    const crumbs = listing?.crumbs ?? [];
    const parent = crumbs.length > 1 ? crumbs.at(-2) : undefined;
    const inside = listing?.entries?.filter(entry => !entry.hidden) ?? [];
    const browseView = listing ? <div key={`browse:${listing.path}`} className='bt-folder-view'><button type='button' role='menuitem' className='bt-folder-back' onClick={() => setView('list')}><ChevronLeftIcon /><span className='bt-menu-label'>{t('Back')}</span></button><div className='bt-folder-path bt-folder-here'>{listing.path}</div>{parent ? <button type='button' role='menuitem' title={parent.path} onClick={() => browse(parent.path)}><FolderIcon /><span className='bt-menu-label'>{t('Up one level')}</span></button> : null}{inside.map(entry => <button key={entry.path} type='button' role='menuitem' onClick={() => browse(entry.path)}><FolderIcon /><span className='bt-menu-label'>{entry.name}</span><ChevronRightIcon /></button>)}{inside.length === 0 ? <div className='bt-model-none'>{t('No folders inside.')}</div> : null}{listing.truncated ? <div className='bt-folder-path bt-folder-here'>{t('Some folders are not shown.')}</div> : null}<div className='bt-menu-sep' role='separator'/><button type='button' role='menuitem' className='bt-folder-use' onClick={() => choose(listing.path)}>{t('Use this folder')}</button></div> : null;
    const shownView = view === 'type' ? typeView : view === 'browse' && browseView ? browseView : listView;
    return <><button ref={button} type='button' className='bt-model-trigger' data-wide={wide || undefined} aria-haspopup='menu' aria-expanded={isOpen} aria-label={team ? t('Team workspace: {folder}', { folder: value ?? '' }) : t('Working folder: {folder}', { folder: value ?? fallback })} title={value} onClick={toggle} disabled={disabled} onKeyDown={(event) => { if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        toggle();
    } }}><span className='bt-model-copy'><span className='bt-model-name'>{value ? folderName(value) : fallback}</span>{value ? <span className='bt-model-provider'>{value}</span> : null}</span><Caret /></button>{shownPlace ? createPortal(<div ref={menu} className={`bt-menu bt-model-menu bt-folder-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`} role='menu' aria-label={team ? t('Team workspace') : t('Working folder')} style={shownPlace} data-leaving={leaving || undefined}>{shownView}{problem ? <div className='bt-folder-error' role='alert'>{problem}</div> : null}</div>, document.body) : null}</>;
}
export const FOLDER_CSS = `
.bt-folder-view{display:flex;flex-direction:column;gap:2px;animation:bt-veil-in .14s ease-out}
.bt-folder-copy{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-folder-copy .bt-menu-label{flex:none}
.bt-folder-path{min-width:0;font-size:11px;line-height:14px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-folder-here{padding:0 8px 4px;white-space:normal;overflow-wrap:anywhere}
.bt-menu .bt-folder-back{color:var(--bt-ink-2);font-weight:500}
.bt-folder-input{height:30px;margin:2px 4px;padding:0 8px;border:1px solid var(--bt-line-2);border-radius:8px;background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13px;outline:none;box-sizing:border-box}
.bt-folder-input:focus{border-color:var(--bt-accent)}
.bt-menu .bt-folder-use{justify-content:center;font-weight:500;color:var(--bt-accent)}
.bt-menu .bt-folder-use:disabled{color:var(--bt-ink-3);cursor:default;background:none}
.bt-model-trigger:disabled{opacity:.6;cursor:default}
.bt-folder-error{padding:4px 8px;font-size:12px;line-height:16px;color:var(--bt-danger);overflow-wrap:anywhere}
@media (prefers-reduced-motion:reduce){.bt-folder-view{animation:none}}
`;
