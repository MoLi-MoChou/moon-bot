export const ENGINE_CSS = `
.bt-engine-view{display:flex;flex-direction:column;gap:2px;animation:bt-veil-in .14s ease-out}
.bt-engine-copy{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-engine-copy .bt-menu-label{flex:none}
.bt-engine-sub{min-width:0;font-size:11px;line-height:14px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-menu .bt-engine-off{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;text-align:left;opacity:.55;cursor:default}
.bt-engine-dot{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--bt-ink-3);flex:none}
.bt-engine-dot[data-online]{background:var(--bt-green);animation:bt-engine-pulse 2.4s ease-out infinite}
@keyframes bt-engine-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bt-green) 45%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.bt-engine-view{animation:none}.bt-engine-dot[data-online]{animation:none}}
`
