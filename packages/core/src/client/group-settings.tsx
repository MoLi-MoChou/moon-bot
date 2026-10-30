import { createElement as h, useEffect, useState } from 'react';
import { isMainOf } from './sources.ts';
import { PlusIcon, ChevronRightIcon } from './icons.tsx';
import { AdminStar, BotAvatar, BotMark, RoomAvatar } from './mark.tsx';
import { Card, Row, InlineText, SwitchRow } from 'moon-bot-ui';
import { Segmented } from './motion.tsx';
import { FolderMenu } from './folder-menu.tsx';
import { PermissionPicker } from './permission-picker.tsx';
import { t } from './i18n.ts';
// A member as a group's settings show it.
interface GroupBot {
    id: string;
    name: string;
}
// A group chat: the fields its settings read and change.
export interface GroupRoom {
    id: string;
    name: string;
    named?: boolean;
    notice?: string;
    admin?: string | null;
    mode: string;
    members: readonly string[];
    permission?: string | null;
    workDir?: string;
    pinned?: boolean;
    hidden?: boolean;
    archivedAt?: number;
}
export interface GroupRoster {
    bots: GroupBot[];
    byId: Record<string, GroupBot | undefined>;
    mainBotIds?: readonly string[];
    permissions?: {
        options: readonly {
            value: string;
            name?: string | undefined;
        }[];
        defaultPreset?: string | null;
    };
}
export interface GroupActions {
    updateRoom: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
    deleteRoom: (id: string) => Promise<unknown>;
    archiveRoom?: ((id: string, archived: boolean) => Promise<unknown>) | undefined;
    createRoom: (members: readonly string[], options: Record<string, unknown>) => Promise<{
        id: string;
        name: string;
        members: readonly string[];
    } | undefined>;
    setFlags: (id: string, flags: Record<string, boolean>) => Promise<unknown>;
    closeSettings: () => void;
    openSession: (id: string) => void;
}
export type RunWork = (work: Promise<unknown>) => Promise<unknown>;
export const ROOM_MODES: readonly (readonly [
    string,
    string,
    string
])[] = [
    ['admin', 'Admin leads', 'Plain messages go to the admin, who calls others with @Name.'],
    ['everyone', 'Everyone', 'Every member answers in turn, admin first.'],
];
// Without an admin the host answers as everyone, whatever the stored mode says.
export const shownMode = (room: GroupRoom, roster: GroupRoster): string => (room.admin && roster.byId[room.admin] ? room.mode : 'everyone');
export function roomSubtitle(room: GroupRoom, roster: GroupRoster): string {
    const admin = room.admin ? roster.byId[room.admin] : undefined;
    return [t('{count} members', { count: room.members.length }), admin ? t('Admin {name}', { name: admin.name }) : t('No admin')].join(' · ');
}
// One preset for every member in the group, or each member's own. Turning it on starts
// from the host's default preset.
function GroupPermission({ room, catalog, update }: {
    room: GroupRoom;
    catalog: GroupRoster['permissions'];
    update: (patch: Record<string, unknown>) => unknown;
}) {
    if (!catalog?.options?.length)
        return null;
    const shared = room.permission !== undefined;
    return <Card title={t('Permissions')}>
      <SwitchRow label={t('Same for every member')} hint={t("Replaces each member's own permissions in this group.")} on={shared} onChange={(on: boolean) => update({ permission: on ? catalog?.defaultPreset ?? catalog?.options[0]?.value ?? null : null })} />
      {shared ? <div className='bt-set-row bt-bs-row bt-bs-stack bt-gs-perm bt-veil'><PermissionPicker catalog={catalog} saved={room.permission ?? ''} onPick={(permission: string) => update({ permission })} /></div> : null}
    </Card>;
}
// A group chat's settings as grouped cards: its name and notice, who answers, its
// members and admin, its permissions, its sidebar place, and deleting it. The user may
// change all of it; the host enforces what Bots may change.
export function GroupSettingsForm({ room, roster, actions, run, onDeleted }: {
    room: GroupRoom;
    roster: GroupRoster;
    actions: GroupActions;
    run: RunWork;
    onDeleted?: () => void;
}) {
    const [adding, setAdding] = useState(false);
    const [confirming, setConfirming] = useState(false);
    useEffect(() => {
        if (!confirming)
            return undefined;
        const timer = setTimeout(() => setConfirming(false), 4000);
        return () => clearTimeout(timer);
    }, [confirming]);
    const members = room.members.map(id => roster.byId[id]).filter((bot): bot is GroupBot => bot !== undefined);
    const outside = roster.bots.filter(bot => !room.members.includes(bot.id));
    const admin = room.admin ? roster.byId[room.admin] : undefined;
    const mode = shownMode(room, roster);
    const modeHint: string = ROOM_MODES.find(([id]) => id === mode)?.[2] ?? '';
    const update = (patch: Record<string, unknown>) => run(actions.updateRoom(room.id, patch));
    const openBot = (id: string) => { actions.closeSettings(); actions.openSession(id); };
    const remove = () => {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        void Promise.resolve(run(actions.deleteRoom(room.id))).then((done) => { if (done)
            onDeleted?.(); });
    };
    return <div className='bt-bs'><div className='bt-bs-hero'><RoomAvatar room={room} roster={roster} size={64} /><div className='bt-bs-who'><span className='bt-bs-name'>{room.name}</span><span className='bt-bs-sub'>{roomSubtitle(room, roster)}</span></div></div><Card title={t('Profile')}>
      <Row label={t('Name')} hint={t('Leave it empty to name the group after its members.')}>
        <InlineText label={t('Group name')} value={room.named ? room.name : ''} placeholder={t('Name after members')} maxLength={60} onSave={name => update({ name })} />
      </Row>
      <Row label={t('Notice')} hint={t('Every member reads it before speaking in this group.')} stack>
        <InlineText label={t('Group notice')} value={room.notice ?? ''} multiline maxLength={2000} placeholder={t('Shared instructions every member reads before speaking…')} onSave={notice => update({ notice })} />
      </Row>
    </Card><Card title={t('Who answers')}>
      <div className='bt-set-row bt-bs-row bt-bs-stack'><Segmented label={t('Who answers')} value={mode}>{ROOM_MODES.map(([id, label]) => <button key={id} type='button' aria-pressed={mode === id} disabled={id === 'admin' && !admin} title={id === 'admin' && !admin ? t('Choose an admin first') : undefined} onClick={() => { if (mode !== id)
        void update({ mode: id }); }}>{t(label)}</button>)}</Segmented><span key={mode} className='bt-set-hint bt-veil'>{`${t(modeHint)} ${t('@mentions always pick who answers.')}`}</span></div>
    </Card><Card title={t('Working folder')}>
          <div className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Folder')}</span></span><FolderMenu value={room.workDir} group actions={actions as never} run={run} onPick={(workDir: string) => update({ workDir })} /></div>
        </Card><GroupPermission room={room} catalog={roster.permissions} update={update} /><Card title={t('Members · {count}', { count: members.length })}>
          {members.map((member) => {
        const leads = room.admin === member.id;
        return <div key={member.id} className='bt-set-row bt-bs-row bt-gs-member'><button type='button' className='bt-gs-who' title={t("Open {name}'s chat", { name: member.name })} onClick={() => openBot(member.id)}><BotAvatar bot={member} size={26} main={isMainOf(roster, member.id)} admin={leads} live={false} /><span className='bt-row-title'>{member.name}</span>{leads ? <span className='bt-tag'>{t('Admin')}</span> : null}</button>{leads
            ? <button type='button' className='bt-mini' title={t('Leave the group without an admin')} onClick={() => update({ admin: null })}>{t('Unset')}</button> : <button type='button' className='bt-mini' onClick={() => update({ admin: member.id })}>{t('Make admin')}</button>}{members.length > 2 ? <button type='button' className='bt-x' aria-label={t('Remove {name} from the group', { name: member.name })} title={t('Remove from group')} onClick={() => update({ remove: [member.id] })}>×</button> : null}</div>;
    })}
          {adding
        ? [...outside.map(bot => <button key={bot.id} type='button' className='bt-set-row bt-bs-row bt-gs-pick' onClick={() => { setAdding(false); void update({ add: [bot.id] }); }}><BotMark bot={bot} size={22} /><span className='bt-set-copy'><span className='bt-bs-label'>{bot.name}</span></span><span className='bt-set-hint'>{t('Add')}</span></button>), <button key='cancel' type='button' className='bt-set-row bt-bs-row bt-gs-add' onClick={() => setAdding(false)}>{t('Cancel')}</button>]
        : outside.length > 0
            ? <button type='button' className='bt-set-row bt-bs-row bt-gs-add' onClick={() => setAdding(true)}><PlusIcon />{t('Add member')}</button> : null}
          <div className='bt-set-row bt-gs-note'><span className='bt-set-hint'>{
    // The host checks for two members on every change, even a rename.
    members.length < 2 ? t('Add a Bot first: a group chat needs at least two.')
        : admin ? t('{name} leads this group: it can call members with @Name, change the group, and post here.', { name: admin.name })
            : t('No admin yet. An admin can call members with @Name, change the group, and post here.')}</span></div>
        </Card><Card title={t('Sidebar')}>
              <SwitchRow label={t('Pin')} hint={t('Kept above the other chats.')} on={room.pinned === true} onChange={pinned => run(actions.setFlags(room.id, { pinned }))} />
              <SwitchRow label={t('Hide from sidebar')} hint={t('Search still finds it.')} on={room.hidden === true} onChange={hidden => run(actions.setFlags(room.id, { hidden }))} />
            </Card><Card title={t('Manage')}>
              <button type='button' className='bt-set-row bt-bs-row' onClick={() => { const archive = actions.archiveRoom; if (archive !== undefined) void run(archive(room.id, room.archivedAt === undefined)); }}><span className='bt-set-copy'><span className='bt-bs-label'>{room.archivedAt === undefined ? t('Archive group') : t('Restore group')}</span><span className='bt-set-hint'>{room.archivedAt === undefined ? t('Stops new rounds. The chat, members and memory stay.') : t('The group returns to the sidebar and can speak again.')}</span></span></button>
              <button type='button' className='bt-set-row bt-bs-row bt-bs-danger' data-confirm={confirming || undefined} onClick={remove}><span className='bt-set-copy'><span className='bt-bs-label'>{confirming ? t('Delete {name}?', { name: room.name }) : t('Delete group')}</span><span className='bt-set-hint'>{confirming ? t('Click again to delete. Its history is archived.') : t('Removes the group chat. Its members stay on the team.')}</span></span><span className='bt-chevron'><ChevronRightIcon /></span></button>
            </Card></div>;
}
// A new group chat from Settings: its admin first, then the other members, then a name
// if the member names will not do.
export function NewGroupForm({ roster, actions, run, onCreated, onCancel }: {
    roster: GroupRoster;
    actions: GroupActions;
    run: RunWork;
    onCreated: (room: {
        id: string;
        name: string;
        members: readonly string[];
    }) => void;
    onCancel: () => void;
}) {
    const [admin, setAdmin] = useState<string | null>(null);
    const [members, setMembers] = useState<string[]>([]);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const toggle = (id: string) => setMembers(list => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]));
    const pickAdmin = (id: string) => { setAdmin(id); setMembers(list => list.filter(item => item !== id)); };
    const create = async () => {
        if (busy || admin === null || members.length === 0)
            return;
        setBusy(true);
        let room: {
            id: string;
            name: string;
            members: readonly string[];
        } | undefined;
        const done = await run(actions.createRoom([admin, ...members], { admin, greet: true, ...(name.trim() ? { name: name.trim() } : {}) }).then((value) => { room = value; }));
        if (done && room)
            onCreated(room);
        else
            setBusy(false);
    };
    const chip = (bot: GroupBot, on: boolean, onClick: () => void, role: string) => <button key={bot.id} type='button' role={role} className='bt-ng-chip' aria-checked={on} onClick={onClick}><BotAvatar bot={bot} size={22} badge={false} live={false} /><span className='bt-ng-name'>{bot.name}</span>{on && role === 'radio' ? <AdminStar /> : null}</button>;
    return <div className='bt-set-card bt-ng'><div className='bt-set-row bt-bs-row bt-bs-stack'><span className='bt-set-copy'><span className='bt-bs-label bt-ng-label'><AdminStar />{t('Choose the group admin')}</span></span><div className='bt-ng-picks' role='radiogroup' aria-label={t('Group admin')}>{roster.bots.map(bot => chip(bot, admin === bot.id, () => pickAdmin(bot.id), 'radio'))}</div></div>{admin === null ? null : <div className='bt-set-row bt-bs-row bt-bs-stack bt-ng-step'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Who to chat with…')}</span></span><div className='bt-ng-picks' role='group' aria-label={t('Members')}>{roster.bots.filter(bot => bot.id !== admin).map(bot => chip(bot, members.includes(bot.id), () => toggle(bot.id), 'checkbox'))}</div></div>}{admin === null || members.length === 0 ? null : <label className='bt-set-row bt-bs-row bt-ng-step'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Name')}</span></span><input className='bt-bs-input' value={name} maxLength={60} placeholder={t('Name after members')} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}/></label>}<div className='bt-set-row bt-task-foot'><button type='button' className='bt-soft bt-soft-sm' onClick={onCancel}>{t('Cancel')}</button><button type='button' className='bt-send bt-soft-sm' disabled={busy || admin === null || members.length === 0} onClick={() => void create()}>{t('Create group chat')}</button></div></div>;
}
export const GROUP_SETTINGS_CSS = `
.bt-ng{animation:bt-q-in .4s cubic-bezier(.22,1,.36,1),bt-veil-in .2s ease-out}
.bt-ng-step{animation:bt-veil-in .22s ease-out}
.bt-ng-label{display:inline-flex;align-items:center;gap:6px}
.bt-ng-picks{display:flex;flex-wrap:wrap;gap:6px}
.bt-ng-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px 0 5px;border-radius:999px;border:.5px solid var(--bt-line);background:var(--bt-card);color:var(--bt-ink-2);font:inherit;font-size:13px;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease,scale .3s cubic-bezier(.34,1.56,.64,1)}
.bt-ng-chip:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-ng-chip:active{scale:.96}
.bt-ng-chip[aria-checked=true]{background:var(--bt-active);border-color:var(--bt-line-2);color:var(--bt-ink)}
.bt-ng-chip .bt-admin-star{animation:bt-check-pop .4s cubic-bezier(.34,1.56,.64,1)}
.bt-ng-name{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.bt-ng,.bt-ng-step,.bt-ng-chip .bt-admin-star{animation:none}}
.bt-gs-member{gap:8px}
.bt-gs-who{flex:1;display:flex;align-items:center;gap:8px;min-width:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bt-gs-who .bt-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-gs-who:hover .bt-row-title{text-decoration:underline;text-underline-offset:2px}
.bt-gs-add{gap:8px;color:var(--bt-ink-2)}
.bt-gs-pick{gap:10px;animation:bt-rise .16s ease-out}
.bt-bs-stack .bt-seg{align-self:stretch}
.bt-gs-perm .bt-seg button{flex:auto;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.bt-gs-pick{animation:none}}
`;
