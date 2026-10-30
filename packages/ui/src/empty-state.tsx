import { createElement as h } from 'react';
import type { ReactNode } from 'react';
// The one action an empty state may offer: it must really do something here.
export interface EmptyStateAction {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
}
export interface EmptyStateProps {
    icon?: ReactNode;
    art?: ReactNode;
    title?: ReactNode;
    hint?: ReactNode;
    action?: EmptyStateAction;
    compact?: boolean;
}
// One look for every list, panel and search that has nothing to show yet: a mark on
// a soft accent disc, a title, a hint and at most one action. The action is only
// passed when it really does something here; there is no inert button. `art` takes
// the disc's place when the empty thing already has a face (a Bot's mark).
export function EmptyState({ icon, art, title, hint, action, compact = false }: EmptyStateProps) {
    return <div className='bt-es' data-compact={compact || undefined} role='status'>{art ? <span className='bt-es-art' aria-hidden>{art}</span> : icon ? <span className='bt-es-mark' aria-hidden>{icon}</span> : null}{title ? <span className='bt-es-title'>{title}</span> : null}{hint ? <span className='bt-es-hint'>{hint}</span> : null}{action ? <button type='button' className='bt-es-action' onClick={action.onClick}>{action.icon ?? null}{action.label}</button> : null}</div>;
}
export const EMPTY_STATE_CSS = `
.bt-es{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;margin:auto;max-width:360px;padding:28px 16px;text-align:center;animation:bt-es-in .32s cubic-bezier(.16,1,.3,1) both}
.bt-es[data-compact]{gap:6px;padding:16px 12px}
.bt-es-mark{position:relative;display:flex;align-items:center;justify-content:center;width:52px;height:52px;margin-bottom:6px;border-radius:50%;background:color-mix(in srgb,var(--bt-accent) 12%,var(--bt-card));color:var(--bt-accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--bt-accent) 5%,transparent)}
.bt-es-mark::after{content:'';position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:var(--bt-accent);opacity:.35}
.bt-es[data-compact] .bt-es-mark{width:40px;height:40px;margin-bottom:2px;box-shadow:0 0 0 4px color-mix(in srgb,var(--bt-accent) 5%,transparent)}
.bt-es[data-compact] .bt-es-mark::after{width:6px;height:6px;top:1px;right:1px}
.bt-es-mark svg{width:22px;height:22px}
.bt-es-art{display:flex;margin-bottom:6px}
.bt-es[data-compact] .bt-es-mark svg{width:18px;height:18px}
.bt-es-title{font-size:15px;line-height:22px;font-weight:600;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-es[data-compact] .bt-es-title{font-size:13px;line-height:19px}
.bt-es-hint{font-size:13px;line-height:19px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-es[data-compact] .bt-es-hint{font-size:12px;line-height:17px}
.bt-es-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;margin-top:6px;padding:0 14px;border:0;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:filter .12s ease,transform .12s ease}
.bt-es-action svg{width:14px;height:14px}
.bt-es-action:hover{filter:brightness(1.08)}
.bt-es-action:active{transform:scale(.97)}
.bt-es-action:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
@keyframes bt-es-in{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){.bt-es{animation:none}.bt-es-action{transition:none}}
`;
