import { Fragment, type Ref, createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { paintCss } from './inks.ts';
import { CHARACTERS, PICKER_SHAPES, PICKER_COLUMNS, CHARACTER_COLORS, SHAPES, hasShape, shapeOf, bodyOf, maskBox, holes, nextMarkSerial } from './characters.ts';
import { isMainOf } from './sources.ts';
import { PencilIcon, ChevronRightIcon } from './icons.tsx';
import { lookOf, BotMark } from './mark.tsx';
import { ModelMenu, modelOf } from './model-menu.tsx';
import { EngineMenu } from './engine-menu.tsx';
import { FolderMenu } from './folder-menu.tsx';
import { BotSchedules } from './schedules.tsx';
import { BotCapabilitiesCard } from './capability-settings.tsx';
import { useMemoryCount } from './memory-panel.tsx';
import { SPRING_SHAPE, SPRING_TAP, spring, useGlide } from './motion.tsx';
import { t } from './i18n.ts';
import { BotResetCard, type ResetActions } from './bot-reset.tsx';
import { ProactiveCard, type ProactiveActions } from './proactive-page.tsx';
import type { AvatarEditorProps, BotPatch, BotSettingsFormProps, CardProps, CharacterGridProps, InlineTextProps, RowProps, SettingsActions, SettingsBot, SettingsBotEngine, SettingsEngineOption, SettingsRoster, SwitchProps, SwitchRowProps } from './settings-types.ts';
const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
// Uploaded avatars are center-cropped to a small square so state.json stays light.
export async function avatarImage(file: File): Promise<string> {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
        throw new Error(t('Choose a PNG, JPEG, WebP, or GIF image'));
    if (file.size > 25 * 1024 * 1024)
        throw new Error(t('Choose an image smaller than 25 MB'));
    const bitmap = await createImageBitmap(file);
    const side = 160;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (context === null)
        throw new Error('canvas 2d context unavailable');
    context.imageSmoothingQuality = 'high';
    const crop = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
    bitmap.close?.();
    for (const quality of [0.9, 0.75, 0.6]) {
        const url = canvas.toDataURL('image/webp', quality);
        if (url.startsWith('data:image/webp') && url.length < 150000)
            return url;
    }
    const png = canvas.toDataURL('image/png');
    if (png.length < 150000)
        return png;
    throw new Error(t('That image is too large'));
}
// Settings save on blur or Enter, with no Save button; Escape puts the
// saved value back. A required field never saves empty.
export function InlineText({ label, value, placeholder, required = false, maxLength, multiline = false, onSave }: InlineTextProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const reverting = useRef(false);
    const commit = (): void => {
        const next = draft?.trim();
        setDraft(null);
        if (reverting.current) {
            reverting.current = false;
            return;
        }
        if (next === undefined || next === (value ?? '') || (required && next === ''))
            return;
        void onSave(next);
    };
    const shared = {
        className: multiline ? 'bt-bs-input bt-bs-area' : 'bt-bs-input',
        value: draft ?? value ?? '',
        placeholder,
        maxLength,
        required,
        'aria-label': label,
        spellCheck: false,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                reverting.current = true;
                event.currentTarget.blur();
            }
            if (event.key === 'Enter' && !multiline && !event.nativeEvent.isComposing)
                event.currentTarget.blur();
        },
    };
    return multiline ? <textarea {...shared}/> : <input {...shared}/>;
}
// One labelled card row with its control on the right, or below when `stack`.
export function Row({ label, hint, stack = false, children }: RowProps) {
    return <label className={stack ? 'bt-set-row bt-bs-row bt-bs-stack' : 'bt-set-row bt-bs-row'}><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span>{hint ? <span className='bt-set-hint'>{hint}</span> : null}</span>{children}</label>;
}
export function Card({ title, children }: CardProps) {
    return <section className='bt-set-section'>{title ? <h3>{title}</h3> : null}<div className='bt-set-card'>{children}</div></section>;
}
export function Switch({ on, label, disabled, onChange }: SwitchProps) {
    return <button type='button' role='switch' className='bt-switch' aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}><span className='bt-switch-knob' aria-hidden/></button>;
}
// A row with a switch. Not a label: a click on the copy must not flip it twice.
export function SwitchRow({ label, hint, on, disabled, onChange }: SwitchRowProps) {
    return <div className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span>{hint ? <span className='bt-set-hint'>{hint}</span> : null}</span><Switch on={on} label={label} disabled={disabled} onChange={onChange} /></div>;
}
function modelHint(bot: SettingsBot, roster: SettingsRoster): string {
    const shown = modelOf(bot, roster);
    if (shown === undefined)
        return t('Pick the model this Bot runs on.');
    if (!shown.served && (roster.models ?? []).length > 0)
        return t('This model is not available now. Pick another one.');
    if (bot.appliedModel && bot.appliedModel === bot.model)
        return t('Every message of this Bot runs on it.');
    return t('Applies from the next message.');
}
// The selection ring of a picker cell follows the shape: a 1px line 3px outside it.
function ShapeRing({ shape, size }: {
    shape: string;
    size: number;
}) {
    const maskId = useRef('');
    if (maskId.current === '')
        maskId.current = `bt-ring-${nextMarkSerial()}`;
    const def = shapeOf(shape);
    const unit = def.size / size;
    const markup = `<defs><mask id="${maskId.current}" ${maskBox(def.size)}>${holes(def, `<g stroke="#000" stroke-width="${6 * unit}" stroke-linejoin="round">${bodyOf(def, '#000', true)}</g>`)}</mask></defs><g mask="url(#${maskId.current})" stroke="currentColor" stroke-width="${8 * unit}" stroke-linejoin="round">${bodyOf(def, 'currentColor', true)}</g>`;
    return <svg className='bt-ring' viewBox={`0 0 ${def.size} ${def.size}`} aria-hidden dangerouslySetInnerHTML={{ __html: markup }}/>;
}
// Every character shape, six to a row, then the color swatches.
export function CharacterGrid({ look, hasPhoto = false, onShape, onColor }: CharacterGridProps) {
    const shapes = [...PICKER_SHAPES, ...Object.keys(SHAPES).filter(id => !Object.hasOwn(CHARACTERS, id))];
    if (!shapes.includes(look.shape))
        shapes.push(look.shape);
    const rows: string[][] = [];
    for (let index = 0; index < shapes.length; index += PICKER_COLUMNS)
        rows.push(shapes.slice(index, index + PICKER_COLUMNS));
    return <><div className='bt-shapes' role='group' aria-label={t('Character shape')}>{rows.map((row, index) => <div key={index} className='bt-shape-row'>{row.map(id => <button key={id} type='button' className='bt-shape' aria-label={t(shapeOf(id).label)} title={t(shapeOf(id).label)} aria-pressed={!hasPhoto && look.shape === id} onClick={() => onShape(id)}><ShapeRing shape={id} size={36} /><BotMark look={{ shape: id, color: look.color }} size={36} /></button>)}</div>)}</div><div className='bt-colors' role='group' aria-label={t('Character color')}>{CHARACTER_COLORS.map(color => <button key={color} type='button' className='bt-color' aria-label={t(capitalize(color))} title={t(capitalize(color))} aria-pressed={look.color === color} onClick={() => onColor(color)}><span style={{ background: paintCss(color) }}/></button>)}</div></>;
}
// The avatar editor: the Bot tab picks a character (every click saves), the
// Upload tab takes a photo, and Reset returns to the look the Bot id gives.
function AvatarEditor({ bot, actions, run, onClose }: AvatarEditorProps) {
    const look = lookOf(bot);
    const [tab, setTab] = useState<'bot' | 'upload'>(look.image ? 'upload' : 'bot');
    const [over, setOver] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const storedShape = bot.avatar?.shape;
    const upload = (file: File | undefined): void => {
        if (file)
            void run(avatarImage(file).then(image => actions.updateBot(bot.id, { avatar: { ...bot.avatar, image } })));
    };
    useEffect(() => {
        const onDown = (event: MouseEvent): void => {
            if (!(event.target instanceof Element) || ref.current?.contains(event.target) || event.target.closest('.bt-avatar-trigger'))
                return;
            onClose();
        };
        const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
        } };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey, true);
        return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
    }, [onClose]);
    useEffect(() => {
        if (tab !== 'upload')
            return undefined;
        const onPaste = (event: ClipboardEvent): void => {
            const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
            if (file) {
                event.preventDefault();
                upload(file);
            }
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [tab, bot]);
    const hasPhoto = Boolean(look.image);
    const glide = useGlide(tab);
    return <div ref={ref} className='bt-avedit' role='dialog' aria-label={t('Avatar editor')}><div className='bt-avedit-top'><div ref={glide.box as Ref<HTMLDivElement>} role='tablist' aria-label={t('Avatar source')} className='bt-avedit-tabs'><span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden/>{([['bot', 'Bot'], ['upload', 'Upload']] as const).map(([id, label]) => <button key={id} type='button' role='tab' className='bt-avedit-tab' aria-selected={tab === id} onClick={() => setTab(id)}>{t(label)}</button>)}</div><button type='button' className='bt-avedit-tab bt-avedit-reset' title={t('Reset character to default')} onClick={() => run(actions.updateBot(bot.id, { avatar: null, color: null }))}>{t('Reset')}</button></div>{tab === 'bot' ? <CharacterGrid look={look} hasPhoto={hasPhoto} onShape={shape => run(actions.updateBot(bot.id, { avatar: { shape } }))} onColor={color => run(actions.updateBot(bot.id, { color }))} /> : null}{tab === 'upload' ? <div className='bt-dropzone' data-over={over || undefined} onDragOver={(event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); setOver(false); upload(event.dataTransfer.files?.[0]); }}>{hasPhoto ? <img src={look.image} alt=''/> : null}<div>{t('Drag, drop, or paste an image')}</div><div className='bt-actions' style={{ justifyContent: 'center' }}><button type='button' className='bt-soft bt-soft-sm' onClick={() => fileRef.current?.click()}>{hasPhoto ? t('Replace') : t('Browse files')}</button>{hasPhoto ? <button type='button' className='bt-soft bt-soft-sm' onClick={() => run(actions.updateBot(bot.id, { avatar: hasShape(storedShape) ? { shape: storedShape } : null }))}>{t('Remove photo')}</button> : null}</div><input ref={fileRef} type='file' accept='image/png,image/jpeg,image/webp,image/gif' hidden onChange={(event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; upload(file); }}/></div> : null}</div>;
}
function MemoryCard({ bot, actions }: {
    bot: SettingsBot;
    actions: SettingsActions;
}) {
    const count = useMemoryCount(bot.id, actions as never);
    const label = count === null ? t('Loading…') : count === 0 ? t('Nothing saved yet') : count === 1 ? t('1 entry') : t('{count} entries', { count });
    return <Card title={t('Memory')}>
      <button type='button' className='bt-set-row bt-bs-row' aria-label={t("Manage {name}'s memory", { name: bot.name })} onClick={() => actions.openMemory(bot.id)}><span className='bt-set-copy'><span className='bt-bs-label'>{label}</span></span><span className='bt-mem-row-go'>{t('Manage')}<ChevronRightIcon /></span></button>
    </Card>;
}
function engineArgsText(engine: SettingsBotEngine | undefined): string {
    return engine?.kind === 'acp' ? (engine.args ?? []).join('\n') : '';
}
function engineFrom(command: string, argsText: string, key?: string): SettingsBotEngine {
    return { kind: 'acp', command, args: argsText.split('\n').map(value => value.trim()).filter(Boolean), ...(key ? { key } : {}) };
}
function EngineCard({ bot, save, refreshEngines }: { bot: SettingsBot; save: (patch: BotPatch) => Promise<boolean>; refreshEngines?: (() => Promise<{ engines: readonly SettingsEngineOption[]; of: Readonly<Record<string, string>> }>) | undefined }) {
    const [available, setAvailable] = useState<readonly SettingsEngineOption[]>([]);
    const acp = bot.engine?.kind === 'acp';
    const command = acp ? bot.engine?.command ?? '' : '';
    const args = engineArgsText(bot.engine);
    useEffect(() => {
        if (!refreshEngines)
            return undefined;
        let alive = true;
        void refreshEngines().then(result => { if (alive) setAvailable(result.engines); });
        return () => { alive = false; };
    }, [refreshEngines, bot.id]);
    const remote = bot.engine?.kind === 'acp-remote';
    const localCount = available.filter(entry => entry.kind === 'acp' && entry.selectable !== false).length;
    return <Card title={t('Execution engine')}>
      <Row label={t('Engine')} hint={acp ? t('Runs this Bot through an external ACP agent.') : remote ? t('Runs this Bot through a remote agent invited over the relay.') : t('Runs this Bot through Moon Bot built-in runtime.')}>
        <EngineMenu bot={bot} save={save} refreshEngines={refreshEngines} />
      </Row>
      {acp ? <Row label={t('ACP command')} hint={t('Executable available on this computer, for example opencode or claude.')}>
      <InlineText label={t('ACP command')} value={command} placeholder='opencode' required maxLength={400} onSave={next => save({ engine: engineFrom(next, args, bot.engine?.key), runtimeId: null })} />
    </Row> : null}
      {acp ? <Row label={t('ACP arguments')} hint={t('One argument per line.')}>
      <InlineText label={t('ACP arguments')} value={args} multiline onSave={next => save({ engine: engineFrom(command, next, bot.engine?.key), runtimeId: null })} />
    </Row> : null}
      {remote ? <Row label={t('Agent ID')} hint={t('The invite names this agent; it answers when its CLI is connected.')}>
      <code className='bt-bs-input' style={{ textAlign: 'left' }}>{bot.engine?.agentId ?? ''}</code>
    </Row> : null}
      {acp && localCount === 0 ? <div className='bt-set-hint'>{t('No compatible local ACP agents detected. Install one and refresh the Bot settings.')}</div> : null}
    </Card>;
}
// A Bot's settings as grouped cards: who it is (avatar, name, label), what it runs on
// (model), what it does (instructions), its memory and tasks, its Main Bot role, its
// sidebar place, and copies.
export function BotSettingsForm({ bot, roster, actions, run }: BotSettingsFormProps) {
    const [editing, setEditing] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const closeEditor = useCallback(() => setEditing(false), []);
    useEffect(() => {
        if (!confirming)
            return undefined;
        const timer = setTimeout(() => setConfirming(false), 4000);
        return () => clearTimeout(timer);
    }, [confirming]);
    const isMainBot = isMainOf(roster, bot.id);
    const onlyMain = isMainBot && (roster.mainBotIds ?? []).length === 1;
    const isTile = roster.mainBotId === bot.id;
    const save = (patch: BotPatch): Promise<boolean> => run(actions.updateBot(bot.id, patch));
    const duplicate = (): Promise<boolean> => run(actions.duplicateBot(bot.id).then(copy => actions.openSession(copy.id)));
    const remove = (): void => { if (confirming)
        void run(actions.deleteBot(bot.id));
    else
        setConfirming(true); };
    // the host settings can change the model list at any time; the hint should match it.
    useEffect(() => { void actions.refreshModels?.(); }, [bot.id]);
    return <div className='bt-bs'><div className='bt-bs-hero'><div className='bt-avatar-anchor'><button type='button' className='bt-avatar-trigger' aria-label={t('Edit Bot avatar')} aria-expanded={editing} onClick={() => setEditing(value => !value)}><BotMark bot={bot} size={64} live /><span className='bt-avatar-pencil' aria-hidden><PencilIcon /></span></button>{editing ? <AvatarEditor bot={bot} actions={actions} run={run} onClose={closeEditor} /> : null}</div><div className='bt-bs-who'><span className='bt-bs-name'>{bot.name}</span><span className='bt-bs-sub'>{[bot.role, isMainBot ? t('Main Bot') : ''].filter(Boolean).join(' · ') || t('Bot')}</span></div></div><Card title={t('Profile')}>
      <Row label={t('Name')}>
        <InlineText label={t('Name')} value={bot.name} placeholder='Bob' required maxLength={40} onSave={name => save({ name })} />
      </Row>
      <Row label={t('Label')} hint={t('Optional. Shown under the name.')}>
        <InlineText label={t('Label')} value={bot.role} placeholder={t('Research, admin…')} maxLength={24} onSave={role => save({ role })} />
      </Row>
    </Card><Card title={t('Model')}>
      <div className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Model')}</span><span className='bt-set-hint'>{modelHint(bot, roster)}</span></span><ModelMenu bot={bot} roster={roster} actions={actions} run={run} /></div>
    </Card><EngineCard bot={bot} save={save} refreshEngines={actions.refreshEngines} /><Card title={t('Working folder')}>
      <div className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Folder')}</span></span><FolderMenu value={bot.workDir} actions={actions} run={run} onPick={workDir => save({ workDir })} /></div>
    </Card><Card title={t('Instructions')}>
      <Row label={t('What this Bot does')} hint={t('Its job on the team. Part of the Bot\'s system prompt.')} stack>
        <InlineText label={t('Instructions')} value={bot.instructions} multiline placeholder={t('What this Bot is responsible for…')} onSave={instructions => save({ instructions })} />
      </Row>
    </Card><BotCapabilitiesCard bot={bot as never} roster={roster as never} actions={actions as never} run={run} Card={Card as never} SwitchRow={SwitchRow as never} />{roster.memory === false ? null : <MemoryCard bot={bot} actions={actions} />}<BotSchedules bot={bot} roster={roster} actions={actions} /><Card title={t('Main Bot')}>{onlyMain
        ? <div className='bt-set-row bt-bs-row'><span className='bt-set-copy'><span className='bt-bs-label'>{t('Main Bot')}</span><span className='bt-set-hint'>{t('The only Main Bot. To hand the role to another Bot, use Main Bot on the Bots page.')}</span></span><button type='button' className='bt-soft bt-soft-sm' onClick={() => actions.openSettings('bots')}>{t('Change')}</button></div> : <SwitchRow label={t('Main Bot')} hint={t('Can create and change Bots, and runs every group chat.')} on={isMainBot} onChange={on => run(actions.setMain(bot.id, on))} />}</Card>{
    // The Main Bot tile is always first and always shown, like in the context menu.
    isTile ? null : <Card title={t('Sidebar')}>
      <SwitchRow label={t('Pin')} hint={t('Kept above the other chats.')} on={bot.pinned === true} onChange={pinned => run(actions.setFlags(bot.id, { pinned }))} />
      {isMainBot ? null : <SwitchRow label={t('Hide from sidebar')} hint={t('Search still finds it.')} on={bot.hidden === true} onChange={hidden => run(actions.setFlags(bot.id, { hidden }))} />}
    </Card>}{actions.resetBot === undefined ? null : <BotResetCard bot={bot} actions={actions as unknown as ResetActions} run={run} />}{actions.proactiveList === undefined ? null : <ProactiveCard botId={bot.id} actions={actions as unknown as ProactiveActions} />}<Card title={t('Manage')}>
      <button type='button' className='bt-set-row bt-bs-row' onClick={duplicate}><span className='bt-set-copy'><span className='bt-bs-label'>{t('Duplicate')}</span><span className='bt-set-hint'>{t('A copy with the same job and model, and fresh memory.')}</span></span><span className='bt-chevron'><ChevronRightIcon /></span></button>
      {isMainBot ? null : <button type='button' className='bt-set-row bt-bs-row bt-bs-danger' data-confirm={confirming || undefined} onClick={remove}><span className='bt-set-copy'><span className='bt-bs-label'>{confirming ? t('Delete {name}?', { name: bot.name }) : t('Delete Bot')}</span><span className='bt-set-hint'>{confirming ? t('Click again to delete. Its chats are archived.') : t('Removes the Bot from the team.')}</span></span><span className='bt-chevron'><ChevronRightIcon /></span></button>}
    </Card></div>;
}
export const BOT_SETTINGS_CSS = `
.bt-bs{display:flex;flex-direction:column;gap:18px}
.bt-bs-hero{display:flex;align-items:center;gap:14px;padding:2px 4px}
.bt-bs-who{display:flex;flex-direction:column;min-width:0;gap:2px}
.bt-bs-name{font-size:17px;line-height:24px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-bs-sub{font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-bs .bt-avedit{left:0;transform:none}
.bt-bs-row{min-height:48px}
label.bt-bs-row{cursor:text}
.bt-bs-row>.bt-set-copy{flex:1 1 auto;min-width:68px}
.bt-bs-label{font-size:13px;line-height:18px;font-weight:500;white-space:nowrap}
.bt-bs-row .bt-model-trigger{flex:none;max-width:64%}
.bt-bs-input{flex:0 1 180px;width:0;min-width:80px;max-width:56%;height:30px;box-sizing:border-box;margin:-4px -6px -4px 0;padding:0 8px;border:1px solid transparent;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;text-align:right;outline:none;transition:background-color .12s ease,border-color .12s ease}
.bt-bs-input:hover{background:var(--bt-hover)}
.bt-bs-input:focus{background:var(--bt-main);border-color:var(--bt-line-2);text-align:left}
.bt-bs-input::placeholder{color:var(--bt-ink-3)}
.bt-bs-stack{flex-direction:column;align-items:stretch;gap:8px}
.bt-bs-area{flex:none;width:auto;min-height:112px;height:auto;margin:0 -6px -4px;padding:8px;line-height:19px;text-align:left;resize:vertical;background:var(--bt-hover)}
.bt-bs-area:hover{background:var(--bt-active)}
.bt-bs-danger .bt-bs-label{color:var(--bt-danger)}
.bt-bs-danger[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 8%,transparent)}
.bt-bs-danger[data-confirm]:hover{background:color-mix(in srgb,var(--bt-danger) 12%,transparent)}
.bt-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--bt-line-2);cursor:pointer;transition:background-color .2s ease}
.bt-switch[aria-checked=true]{background:var(--bt-accent)}
.bt-switch:disabled{opacity:.45;cursor:default}
.bt-switch:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:${spring(SPRING_SHAPE, 'transform')},${spring(SPRING_TAP, 'width')}}
.bt-switch[aria-checked=true] .bt-switch-knob{transform:translateX(16px)}
.bt-switch:active:not(:disabled) .bt-switch-knob{width:21px}
.bt-switch[aria-checked=true]:active:not(:disabled) .bt-switch-knob{transform:translateX(11px)}
.bt-avedit :is(.bt-shapes,.bt-colors,.bt-dropzone){animation:bt-veil-in .18s ease-out}
.bt-reset-panel{padding:4px 0 10px}
.bt-reset-part{display:flex;gap:8px;align-items:flex-start;padding:6px 12px;cursor:pointer}
.bt-reset-part input{margin-top:2px;accent-color:var(--bt-accent)}
.bt-reset-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.bt-reset-label{color:var(--bt-ink);font-size:13px}
.bt-reset-loss{display:flex;flex-direction:column;gap:4px;margin:8px 12px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--bt-danger) 7%,transparent);border:.5px solid color-mix(in srgb,var(--bt-danger) 25%,transparent)}
.bt-reset-loss-title{color:var(--bt-danger);font-size:12px;font-weight:600}
.bt-reset-loss-line{color:var(--bt-ink-2);font-size:12px;line-height:1.5}
.bt-reset-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 12px}
.bt-reset-question{color:var(--bt-ink);font-size:13px}
.bt-reset-panel>.bt-soft{margin-left:12px}
.bt-pro-card{padding:2px 12px 12px}
.bt-pro{display:flex;flex-direction:column;gap:10px}
.bt-pro-hint{margin:0;color:var(--bt-ink-2);font-size:12px;line-height:1.5}
.bt-pro-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.bt-pro-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:.5px solid var(--bt-line)}
.bt-pro-row-copy{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.bt-pro-topics{color:var(--bt-ink);font-size:13px}
.bt-pro-meta{color:var(--bt-ink-2);font-size:11.5px;line-height:1.4}
.bt-pro-danger{color:var(--bt-danger)}
.bt-pro-form{display:flex;flex-direction:column;gap:8px;padding:10px 0}
.bt-pro-inline{display:flex;gap:8px;flex-wrap:wrap}
.bt-pro-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px}
.bt-pro-narrow{flex:0 0 auto;min-width:84px}
.bt-pro-label{color:var(--bt-ink-2);font-size:12px}
.bt-pro-field input{padding:6px 8px;border-radius:8px;border:.5px solid var(--bt-line);background:var(--bt-surface);color:var(--bt-ink);font-size:13px}
.bt-pro-error{color:var(--bt-danger);font-size:12px}
.bt-pro-add{display:inline-flex;align-items:center;gap:4px;align-self:flex-start}
.bt-pro-review{display:flex;flex-direction:column;gap:8px;margin-top:6px;padding-top:10px;border-top:.5px solid var(--bt-line)}
.bt-pro-review-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-pro-candidates{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.bt-pro-candidate{display:flex;flex-direction:column;gap:4px;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--bt-ink) 3%,transparent)}
.bt-pro-candidate-text{margin:0;color:var(--bt-ink);font-size:13px;line-height:1.45}
.bt-pro-candidate-why{margin:0;color:var(--bt-ink-2);font-size:12px}
.bt-pro-evidence{margin:0;padding-left:16px;color:var(--bt-ink-2);font-size:11.5px;line-height:1.5}
.bt-pro-outcome{font-size:11.5px;color:var(--bt-ink-2)}
.bt-pro-outcome[data-would=send]{color:var(--bt-accent)}
.bt-pro-outcome[data-would=drop]{color:var(--bt-danger)}
.bt-urow[data-proactive] .bt-ububble{border:.5px solid color-mix(in srgb,var(--bt-accent) 35%,transparent);background:color-mix(in srgb,var(--bt-accent) 6%,transparent)}
.bt-pro-stats{margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--bt-ink) 4%,transparent);color:var(--bt-ink-2);font-size:11.5px;line-height:1.5}
.bt-upmark{display:inline-block;margin-bottom:4px;padding:1px 6px;border-radius:999px;font-size:10.5px;color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 12%,transparent)}
@media (prefers-reduced-motion:reduce){.bt-switch,.bt-switch-knob{transition:none}.bt-avedit :is(.bt-shapes,.bt-colors,.bt-dropzone){animation:none}}
`;
