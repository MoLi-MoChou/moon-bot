// Menus and overlays: context menus, the command palette, the avatar popover, and the
// theme, motion and appearance pickers they open.
import { DIALOG_EXIT_MS, EASE_IN, MENU_EXIT_MS, spring, SPRING_SHAPE, SPRING_TAP } from '../../motion.tsx'

// Menus, palette, popovers, and the settings pickers.
export const OVERLAYS_CSS = `
.bt-menu{position:fixed;pointer-events:auto;z-index:60;min-width:200px;padding:6px;border-radius:12px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1),0 0 0 1px rgba(228,228,228,.04);display:flex;flex-direction:column;gap:2px;transform-origin:var(--bt-origin,top left);animation:bt-pop-drop ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .14s ease-out;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;box-sizing:border-box}
.bt-menu button{display:flex;align-items:center;gap:4px;width:100%;min-height:30px;text-align:left;border:0;background:none;border-radius:6px;padding:6px 8px;font:inherit;font-size:13px;line-height:18px;color:var(--bt-ink);cursor:pointer;box-sizing:border-box}
.bt-menu button:hover{background:var(--bt-hover)}
.bt-menu button svg{flex:none;width:16px;height:16px;margin:0 1px}
.bt-menu .bt-danger{color:var(--bt-danger)}
.bt-menu-sep{height:.5px;flex:none;background:var(--bt-line-2);margin:4px 8px}
.bt-menu-up{--bt-origin:bottom left;animation-name:bt-pop-lift,bt-veil-in}
.bt-menu[data-leaving]{pointer-events:none;animation:bt-pop-out ${MENU_EXIT_MS}ms ${EASE_IN} forwards}
.bt-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-menu-hint{flex:none;color:var(--bt-ink-3);font-size:12px;font-variant-numeric:tabular-nums}
.bt-palette-layer{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:70;pointer-events:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.46);animation:bt-fade .22s ease-out}
.bt-palette{position:absolute;top:50%;left:50%;width:min(560px,92vw);transform:translate(-50%,-50%);display:flex;flex-direction:column;border-radius:12px;background:var(--bt-main);border:1px solid var(--bt-line-2);box-shadow:0 24px 48px -12px rgba(0,0,0,.25);overflow:hidden;color:var(--bt-ink);animation:bt-palette-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-palette-layer[data-leaving]{pointer-events:none}
.bt-palette-layer[data-leaving] .bt-backdrop{opacity:0;transition:opacity ${DIALOG_EXIT_MS}ms ease-in}
.bt-palette-layer[data-leaving] .bt-palette{animation:bt-dialog-sink ${DIALOG_EXIT_MS}ms ${EASE_IN} forwards}
@keyframes bt-palette-in{from{translate:0 -10px;scale:.96}}
.bt-palette-head{display:flex;align-items:center;gap:4px;padding:14px 10px 14px 14px;border-bottom:.5px solid var(--bt-line-2)}
.bt-palette-glyph{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;color:var(--bt-ink-3);margin-right:4px}
.bt-palette-head input{flex:1;min-width:0;border:0;outline:none;background:none;color:var(--bt-ink);font:inherit;font-size:15px;line-height:22px;padding:0}
.bt-palette-head input::placeholder{color:var(--bt-ink-3)}
.bt-palette-clear{width:18px;height:18px;border:0;padding:0;border-radius:6px;background:none;color:var(--bt-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.bt-palette-clear:hover{color:var(--bt-ink)}
.bt-palette-clear svg{width:12px;height:12px}
.bt-palette-list{position:relative;height:402px;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.bt-palette-list>.bt-thumb,.bt-drop-list>.bt-thumb{left:0;right:0;border-radius:8px;background:var(--bt-active)}
.bt-palette-list>.bt-thumb{left:8px;right:8px}
:is(.bt-palette-list,.bt-drop-list)[data-glide] [aria-selected=true]{background:transparent}
:is(.bt-palette-row,.bt-palette-section,.bt-drop-list>.bt-option){position:relative;z-index:1}
.bt-palette-section{padding:8px 8px 4px;font-size:12px;line-height:16px;color:var(--bt-ink-3);flex:none}
.bt-palette-section:first-of-type{padding-top:0}
.bt-palette-row{flex:none;display:flex;align-items:center;gap:8px;height:49px;padding:6px 10px 6px 8px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;width:100%}
.bt-palette-row[aria-selected=true]{background:var(--bt-active)}
.bt-palette-lead{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center}
.bt-palette-cmd{width:24px;height:24px;border-radius:50%;background:var(--bt-hover);display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink-2)}
.bt-palette-cmd svg{width:14px;height:14px}
.bt-palette-agent{width:24px;height:24px;border-radius:50%;background:var(--bt-hover);display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink)}
.bt-palette-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-palette-title{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-palette-sub{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-palette-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.bt-palette-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:0 16px;text-align:center;animation:bt-veil-in .22s ease-out}
.bt-palette-empty-icon{color:var(--bt-line-2)}
.bt-palette-empty-icon svg{width:32px;height:32px}
.bt-palette-empty-label{font-size:14px;font-weight:500;color:var(--bt-ink-2)}
.bt-palette-empty-hint{font-size:13px;line-height:16px;color:var(--bt-ink-3)}
@media (prefers-reduced-motion:reduce){.bt-palette{animation:bt-fade .1s ease-out}}
.bt-account-menu{width:224px}
.bt-account{flex:none;width:36px;height:36px;border:0;padding:0;background:none;border-radius:50%;cursor:pointer;display:inline-flex}
.bt-account:hover .bt-you,.bt-account[aria-expanded=true] .bt-you{background:color-mix(in srgb,var(--bt-ink) 9%,var(--bt-sidebar))}
/* Popover keyframes move translate and scale, which compose with a transform the popover
   already has. */
@keyframes bt-pop-drop{from{translate:0 -4px;scale:.96}}
@keyframes bt-pop-lift{from{translate:0 4px;scale:.96}}
@keyframes bt-pop-out{to{opacity:0;scale:.97;filter:blur(2px)}}
@keyframes bt-veil-in{from{opacity:0;filter:blur(6px)}}
@keyframes bt-check-pop{from{opacity:0;scale:.4}}
@media (prefers-reduced-motion:reduce){.bt-menu,.bt-avedit,.bt-react-strip{animation:bt-fade .1s ease-out}.bt-react-strip button,.bt-q-check,.bt-color[aria-pressed=true] span{animation:none}}
.bt-brand:hover{background:var(--bt-hover)}
.bt-drop-list{position:relative;display:flex;flex-direction:column;gap:2px}
.bt-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
.bt-pick{display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 2px 6px;border-radius:10px;border:1px solid transparent;background:none;color:var(--bt-ink);cursor:pointer;font:inherit;font-size:11px;line-height:14px;min-width:0}
.bt-pick:hover{background:var(--bt-hover)}
.bt-pick[aria-pressed=true]{border-color:var(--bt-line-2);background:var(--bt-hover)}
.bt-pick>span:last-child:not(.bt-mark){max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-pick:hover .bt-mark[data-state=idle] .bt-eye{animation:bt-blink .5s linear 1}
.bt-theme-pick{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.bt-theme-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:4px;border:0;border-radius:12px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-theme-card:hover{color:var(--bt-ink)}
.bt-theme-preview{display:flex;width:96px;height:58px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 .5px var(--bt-line-2);transition:box-shadow .15s ease,transform .15s ease}
.bt-theme-card:hover .bt-theme-preview{transform:translateY(-1px)}
.bt-theme-card[aria-checked=true]{color:var(--bt-ink);font-weight:500}
.bt-theme-card[aria-checked=true] .bt-theme-preview{box-shadow:0 0 0 2px var(--bt-accent)}
.bt-theme-card:focus-visible{outline:none}
.bt-theme-card:focus-visible .bt-theme-preview{box-shadow:0 0 0 2px var(--bt-accent),0 0 0 4px color-mix(in srgb,var(--bt-accent) 30%,transparent)}
.bt-theme-half{flex:1;display:flex;min-width:0}
.bt-theme-side{width:12px;flex:none}
.bt-theme-lines{flex:1;display:flex;flex-direction:column;gap:4px;padding:8px 5px;min-width:0}
.bt-theme-lines span{display:block;height:6px;border-radius:4px;width:80%}
.bt-theme-lines .bt-theme-user{align-self:flex-end;width:55%}
.bt-theme-lines .bt-theme-dot{width:10px;height:10px;border-radius:50%;margin-top:auto;align-self:flex-end}
.bt-select{width:100%;height:34px;box-sizing:border-box;border-radius:8px;border:1px solid var(--bt-line);background:var(--bt-card);color:var(--bt-ink);padding:0 8px;font:inherit;font-size:13px}
.bt-note{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin-top:6px}
.bt-swatch-sep{width:1px;height:22px;background:var(--bt-line-2);margin:0 2px}
.bt-swatch-custom{position:relative;overflow:hidden;background:conic-gradient(#ff3e51,#ffaf38,#00c972,#1cc3b0,#2a92fe,#a97efe,#ff5eb1,#ff3e51);box-sizing:border-box}
.bt-swatch-custom[data-on=true]{border-color:var(--bt-ink)}
.bt-swatch-custom input{position:absolute;inset:-4px;width:calc(100% + 8px);height:calc(100% + 8px);opacity:0;cursor:pointer;border:0;padding:0}
.bt-swatch-default{background:linear-gradient(135deg,var(--bt-card) 0 46%,var(--bt-line-2) 46% 54%,var(--bt-card) 54%);box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-states{display:flex;flex-wrap:wrap;gap:4px}
.bt-state{border:1px solid var(--bt-line);background:none;border-radius:999px;font:inherit;font-size:11px;line-height:16px;padding:2px 8px;color:var(--bt-ink-2);cursor:pointer}
.bt-state:hover{color:var(--bt-ink)}
.bt-state[aria-pressed=true]{background:var(--bt-active);border-color:var(--bt-line-2);color:var(--bt-ink)}
.bt-theme-chip{position:relative;width:46px;height:30px;border-radius:8px;box-shadow:inset 0 0 0 1px var(--bt-line-2);background:linear-gradient(90deg,var(--ls) 0 36%,var(--lb) 36%);overflow:hidden}
.bt-theme-chip i{position:absolute;right:7px;bottom:7px;width:10px;height:10px;border-radius:50%;background:var(--la)}
body[data-ds-dark-theme] .bt-theme-chip{background:linear-gradient(90deg,var(--ds) 0 36%,var(--db) 36%)}
body[data-ds-dark-theme] .bt-theme-chip i{background:var(--da)}
.bt-tabs{flex-wrap:wrap}
.bt-soft:disabled{opacity:.4;cursor:default}
.bt-group-role{margin-left:6px;font-size:11px;line-height:14px;padding:1px 5px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);vertical-align:1px}
.bt-mini{flex:none;border:0;background:none;border-radius:6px;padding:2px 6px;font:inherit;font-size:12px;line-height:18px;color:var(--bt-ink-2);cursor:pointer}
.bt-mini:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-add{color:var(--bt-ink-2);margin-top:2px}
.bt-add:hover,.bt-addlist .bt-option:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-addlist{display:flex;flex-direction:column;margin-top:4px;padding:4px;border:1px solid var(--bt-line);border-radius:10px;background:var(--bt-card);animation:bt-rise .16s ease-out}
.bt-seg{position:relative;display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--bt-hover)}
.bt-motion-seg{width:216px}
.bt-seg button{position:relative;z-index:1;flex:1;height:30px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--bt-ink-2);cursor:pointer;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease,${spring(SPRING_TAP, 'scale')}}
.bt-seg button[aria-pressed=true]{background:var(--bt-card);color:var(--bt-ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.bt-seg button:disabled{opacity:.4;cursor:default}
.bt-seg button:active:not(:disabled){scale:.96}
.bt-seg>.bt-thumb{top:2px;bottom:2px;border-radius:8px;background:var(--bt-card);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.bt-seg[data-glide] button[aria-pressed=true]{background:transparent;box-shadow:none}
@keyframes bt-rise{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.bt-addlist{animation:none}}
`
