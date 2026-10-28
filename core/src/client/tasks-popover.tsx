import { Fragment, createElement as h, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n.ts';
import { CloseIcon, TasksIcon } from './icons.tsx';
import { useEscape } from './overlay-hooks.ts';
import { TasksBoard, useTasks } from './tasks-page.tsx';
import type { TaskActions } from './tasks-page.tsx';
// The sidebar's task popover: the Settings → Tasks board over the conversation, so the
// user can see who is working and stop one without leaving the chat. The open state is
// the sidebar's own; this only draws the dialog and closes on Escape, the scrim, or a
// row that opens that Bot's chat.
export interface TasksPopoverProps {
    readonly taskActions: TaskActions;
    readonly onOpenSession: (sessionId: string) => void;
    readonly onClose: () => void;
}
export function TasksPopover({ taskActions, onOpenSession, onClose }: TasksPopoverProps) {
    const state = useTasks(taskActions);
    const panel = useRef<HTMLDivElement | null>(null);
    useEscape(onClose);
    // Focus the dialog itself, not its first control: Escape then works at once and a
    // screen reader reads the title before the buttons.
    useEffect(() => { panel.current?.focus(); }, []);
    const working = state.answer?.running.length ?? 0;
    return <>{createPortal(<div className='bt-tasks-layer'>
        <div className='bt-scrim' onMouseDown={onClose}/>
        <div ref={panel} className='bt-tasks' role='dialog' aria-modal='true' aria-label={t('Tasks')} tabIndex={-1}>
            <div className='bt-tasks-head'>
                <span className='bt-tasks-icon' aria-hidden><TasksIcon /></span>
                <h2 className='bt-tasks-title'>{t('Tasks')}</h2>
                <span className='bt-tasks-status' role='status'>{working === 0 ? t('Nobody is working right now.') : t('{count} working', { count: working })}</span>
                <button type='button' className='bt-icon-btn' aria-label={t('Close')} title={t('Close')} onClick={onClose}><CloseIcon /></button>
            </div>
            <div className='bt-tasks-body'>
                <TasksBoard state={state} onOpen={sessionId => { onOpenSession(sessionId); onClose(); }} />
            </div>
        </div>
    </div>, document.body)}</>;
}
