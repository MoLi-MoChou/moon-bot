// The right-hand panels: the drawer shell and its tabs, Bot and group settings,
// the settings dialog, connectors, and the memory dialog.
import {
  DIALOG_EXIT_MS,
  EASE_IN,
  EASE_PANEL,
  PANEL_LINGER_MS,
  SHEET_EXIT_MS,
  spring,
  SPRING_POP,
  SPRING_SHAPE,
  SPRING_TAP,
} from '../motion.tsx'

// Side panels, drawers, Bot settings, the settings dialog and connectors.
export const PANELS_CSS = `

/* Side panels keep their content clear of the Windows caption buttons. A host may set the
   chrome top to 0 so that dialog masks also cover the caption band; the panel then reaches
   the top edge, its own surface under the buttons, and the band over it still drags the
   window. Where the chrome top already clears the title bar the band is 0. */
html[data-windows-titlebar]:not([data-fullscreen]) :is(.bt-pane,.bt-panel){--bt-caption-band:calc(var(--bt-windows-titlebar-height,0px) - var(--bt-frame-chrome-top,0px));padding-top:var(--bt-caption-band)}
html[data-windows-titlebar]:not([data-fullscreen]) :is(.bt-pane,.bt-panel)::before{content:"";position:absolute;top:0;left:0;right:0;height:var(--bt-caption-band);-webkit-app-region:drag}
.bt-pane{position:fixed;top:var(--bt-frame-chrome-top,0px);right:0;bottom:0;z-index:45;pointer-events:auto;background:var(--bt-main);color:var(--bt-ink);display:flex;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-dialog{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-dialog .bt-head{height:62px}
.bt-dialog-log{flex:1;overflow-y:auto;padding:8px 16px 20px;width:100%;max-width:var(--bt-chat-content-width,748px);margin:0 auto;box-sizing:border-box}
.bt-dialog-foot{display:flex;justify-content:center;padding:10px 10px 16px}
.bt-exchange{animation:bt-sheet-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} both,bt-veil-in .24s ease-out both}
.bt-exchange[data-leaving]{animation:bt-sheet-out ${SHEET_EXIT_MS}ms ${EASE_IN} forwards;pointer-events:none}
@keyframes bt-sheet-in{from{transform:translateY(24px)}}
@keyframes bt-sheet-out{to{opacity:0;transform:translateY(16px);filter:blur(4px)}}
.bt-exchange .bt-dialog{position:relative}
.bt-exchange .bt-dialog-log{max-width:none;margin:0;padding:39px max(16px,calc((100% - 960px)/2)) 116px;scrollbar-width:thin}
.bt-exchange .bt-tools{display:none}
.bt-fold{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin-top:4px;white-space:normal}
.bt-fold-note{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
[data-folded] .bt-fold-body{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - 40px),transparent)}
.bt-ubody .bt-fold .bt-more,.bt-ububble .bt-fold .bt-more,.bt-ubody .bt-fold-note,.bt-ububble .bt-fold-note{color:inherit;opacity:.7}
.bt-ubody .bt-fold .bt-more:hover,.bt-ububble .bt-fold .bt-more:hover{opacity:1}
.bt-exchange .bt-dialog-foot{position:absolute;left:0;right:0;bottom:0;height:76px;box-sizing:border-box;align-items:flex-end;padding:0 0 28px;background:var(--bt-main);z-index:3;animation:bt-foot-in .3s cubic-bezier(.22,1,.36,1) .3s both}
.bt-exchange .bt-dialog-foot::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:40px;background:linear-gradient(to top,var(--bt-main),transparent);pointer-events:none}
.bt-exchange[data-leaving] .bt-dialog-foot{animation:bt-foot-out ${SHEET_EXIT_MS}ms ${EASE_IN} forwards}
@keyframes bt-foot-in{from{opacity:0;transform:translateY(6px)}}
@keyframes bt-foot-out{to{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){.bt-exchange,.bt-exchange .bt-dialog-foot{animation:none!important}}
.bt-soft{height:36px;border-radius:999px;border:0;background:var(--bt-hover);color:var(--bt-ink);padding:0 16px;font-size:14px;cursor:pointer;flex:none;white-space:nowrap;transition:background-color .12s ease,${spring(SPRING_TAP, 'transform')}}
.bt-soft:hover{background:var(--bt-active)}
.bt-soft:not(:disabled):hover{transform:scale(1.03)}
.bt-soft:not(:disabled):active{transform:scale(.96)}
.bt-time{display:block;text-align:center;font-size:12px;line-height:16px;color:var(--bt-ink-2);padding:6px 0}

.bt-panel{position:fixed;top:var(--bt-frame-chrome-top,0px);right:0;bottom:0;width:var(--bt-panel-w,380px);pointer-events:auto;z-index:40;background:var(--bt-main);border-left:.5px solid var(--bt-line-2);display:flex;flex-direction:column;color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;box-sizing:border-box;animation:bt-pane-in ${PANEL_LINGER_MS}ms ${EASE_PANEL};transition:width ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-panel[data-leaving]{transform:translateX(100%);transition:transform ${PANEL_LINGER_MS}ms ${EASE_PANEL};pointer-events:none}
.bt-panel[data-instant]{transition:none}
@keyframes bt-pane-in{from{transform:translateX(100%)}}
[class*="_centerCol"]{transition:margin-right ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-panel-grip{position:absolute;left:-5px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:3;touch-action:none}
.bt-panel-grip:hover,.bt-panel[data-dragging] .bt-panel-grip{background:linear-gradient(to right,transparent 4px,var(--bt-line-2) 4px,var(--bt-line-2) 6px,transparent 6px)}
.bt-drag-shield{position:fixed;inset:0;z-index:45;cursor:col-resize}
.bt-panel-view{flex:1;min-height:0;display:flex;flex-direction:column}
.bt-panel-error{flex:none;margin:10px 16px 0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--bt-danger) 35%,transparent);border-radius:10px;background:color-mix(in srgb,var(--bt-danger) 8%,var(--bt-main));color:var(--bt-ink);font-size:12px;line-height:17px;overflow-wrap:anywhere}
.bt-drawer-top{display:flex;justify-content:flex-end;gap:8px;padding:12px 17px 6px 12px}
.bt-drawer-id{display:flex;flex-direction:column;align-items:center;padding:14px 16px 0}
.bt-drawer-id>.bt-mark,.bt-drawer-id>.bt-cluster,.bt-drawer-id>.bt-pile{margin-bottom:16px}
.bt-pile{display:flex;align-items:center;justify-content:center;line-height:0}
.bt-pile-face{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;border-radius:50%;background:var(--bt-main);box-shadow:0 0 0 3px var(--bt-main);animation:bt-pile-in .36s cubic-bezier(.34,1.56,.64,1) backwards}
.bt-pile-face+.bt-pile-face{margin-left:-10px}
.bt-pile-more{background:var(--bt-hover);color:var(--bt-ink-2);font-size:13px;line-height:1;font-weight:500;font-variant-numeric:tabular-nums}
@keyframes bt-pile-in{from{opacity:0;transform:translateY(6px) scale(.85)}}
@media (prefers-reduced-motion:reduce){.bt-pile-face{animation:none}}
.bt-drawer-name{font-size:17px;line-height:24px;font-weight:500;border:0;background:none;color:inherit;cursor:text;padding:0 6px;border-radius:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-drawer-name:hover{background:var(--bt-hover)}
.bt-drawer-name-input{font-size:17px;line-height:24px;text-align:center;border:.5px solid var(--bt-line-2);border-radius:6px;padding:0 6px;background:var(--bt-main);color:var(--bt-ink);outline:none;font-weight:500}
.bt-drawer-role{font-size:12px;line-height:16px;color:var(--bt-ink-3);margin-top:6px;text-align:center}
.bt-tabs{position:relative;display:flex;justify-content:center;gap:2px;margin:16px 16px 0}
.bt-tab{position:relative;z-index:1;border:0;background:none;border-radius:9999px;padding:4px 8px;font-size:13px;line-height:20px;color:var(--bt-ink-2);cursor:pointer;white-space:nowrap}
.bt-tab:hover{color:var(--bt-ink)}
.bt-tab[aria-selected=true]{background:var(--bt-hover);color:var(--bt-ink)}
.bt-tabs>.bt-thumb{top:0;bottom:0;border-radius:9999px;background:var(--bt-hover)}
.bt-tabs[data-glide] .bt-tab[aria-selected=true]{background:transparent}
.bt-drawer-body{flex:1;overflow-y:auto;padding:20px 16px 16px;font-size:13px;line-height:18px;display:flex;flex-direction:column;gap:16px}
.bt-empty{text-align:center;color:var(--bt-ink-3);font-size:13px;line-height:18px;padding:8px 12px}
.bt-section-title{font-size:12px;color:var(--bt-ink-2);margin-bottom:6px}
.bt-muted{color:var(--bt-ink-2)}
.bt-swatches{display:flex;flex-wrap:wrap;gap:6px}
.bt-swatch{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-swatch[aria-pressed=true]{border-color:var(--bt-ink)}
.bt-textarea{width:100%;box-sizing:border-box;min-height:120px;border:1px solid var(--bt-line);border-radius:8px;padding:8px;background:var(--bt-card);color:var(--bt-ink);font:inherit;resize:vertical}
.bt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bt-kv{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:20px;color:var(--bt-ink-2)}
.bt-kv span:last-child{color:var(--bt-ink);font-variant-numeric:tabular-nums}
.bt-run-stats{display:flex;flex-wrap:wrap;justify-content:center;gap:0 6px;margin-top:-6px;font-size:12px;line-height:18px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-run-sep{color:var(--bt-ink-3)}
.bt-danger{color:var(--bt-danger)}

/* Bot settings: fields, the avatar editor popover, and the details-pane sub-view. */
.bt-field{display:flex;flex-direction:column;gap:6px}
.bt-field-label{font-size:13px;line-height:18px;font-weight:500}
.bt-input{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--bt-line);border-radius:8px;padding:0 10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13px;outline:none}
.bt-input:focus{border-color:var(--bt-line-2)}
.bt-input-area{height:auto;min-height:96px;padding:8px 10px;line-height:18px;resize:vertical}
.bt-note{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-soft-sm{height:28px;padding:0 12px;font-size:12px}
.bt-set-avatar{display:flex;justify-content:center;padding:4px 0}
.bt-avatar-anchor{position:relative}
.bt-avatar-trigger{position:relative;width:64px;height:64px;border:0;border-radius:50%;background:none;cursor:pointer;padding:0}
.bt-avatar-pencil{position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:var(--bt-main);border:1px solid var(--bt-line-2);color:var(--bt-ink-2);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.12);transition:${spring(SPRING_TAP, 'transform')}}
.bt-avatar-trigger:hover .bt-avatar-pencil{transform:rotate(-14deg) scale(1.12)}
.bt-avedit{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:300px;background:var(--bt-main);border:1px solid var(--bt-line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:10px;z-index:70;display:flex;flex-direction:column;gap:10px;color:var(--bt-ink);transform-origin:top center;animation:bt-pop-drop ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
.bt-bs .bt-avedit{transform-origin:32px 0}
.bt-avedit-top{display:flex;align-items:center;justify-content:space-between}
.bt-avedit-tabs{position:relative;display:flex;gap:2px;background:var(--bt-hover);border-radius:999px;padding:2px}
.bt-avedit-tab{position:relative;z-index:1;border:0;background:none;border-radius:999px;padding:3px 10px;font-size:12px;line-height:16px;color:var(--bt-ink-2);cursor:pointer}
.bt-avedit-tab[aria-selected=true]{background:var(--bt-main);color:var(--bt-ink)}
.bt-avedit-tabs>.bt-thumb{top:2px;bottom:2px;border-radius:999px;background:var(--bt-main);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.bt-avedit-tabs[data-glide] .bt-avedit-tab[aria-selected=true]{background:transparent}
.bt-avedit-reset{color:var(--bt-ink-3)}
.bt-avedit-reset:hover{color:var(--bt-ink)}
.bt-shapes{display:flex;flex-direction:column;gap:2px}
.bt-shape-row{display:grid;grid-template-columns:repeat(6,1fr);gap:2px}
.bt-shape{position:relative;aspect-ratio:1;border:0;border-radius:8px;background:none;color:var(--bt-ink);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.bt-shape:hover{background:var(--bt-hover)}
.bt-shape .bt-ring{position:absolute;left:50%;top:50%;width:36px;height:36px;translate:-50% -50%;overflow:visible;opacity:0;scale:.82;pointer-events:none;transition:opacity .14s ease,${spring(SPRING_POP, 'scale')}}
.bt-shape[aria-pressed=true] .bt-ring{opacity:1;scale:1}
.bt-colors{display:flex;justify-content:space-between}
.bt-color{width:22px;height:22px;border-radius:50%;border:2px solid transparent;padding:2px;background:none;cursor:pointer;box-sizing:border-box;transition:border-color .14s ease,${spring(SPRING_TAP, 'scale')}}
.bt-color[aria-pressed=true] span{animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-color span{display:block;width:100%;height:100%;border-radius:50%}
.bt-color[aria-pressed=true]{border-color:var(--bt-ink)}
.bt-dropzone{border:1.5px dashed var(--bt-line-2);border-radius:10px;padding:18px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:12px;line-height:16px;text-align:center}
.bt-dropzone[data-over]{border-color:var(--bt-accent);color:var(--bt-ink)}
.bt-dropzone img{width:64px;height:64px;border-radius:50%;object-fit:cover}
.bt-set-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bt-about{white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.bt-about[data-open]{display:block;-webkit-line-clamp:unset}
.bt-more{border:0;background:none;color:var(--bt-ink-3);font-size:12px;line-height:16px;cursor:pointer;padding:2px 0}
.bt-more:hover{color:var(--bt-ink)}
.bt-subhead{display:flex;align-items:center;gap:4px;padding:10px 12px 4px}
.bt-subhead-title{flex:1;font-size:15px;line-height:24px;font-weight:600;padding-left:4px}
.bt-icon-btn{width:28px;height:28px;border-radius:50%;border:0;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background-color .12s ease,color .12s ease,${spring(SPRING_TAP, 'transform')}}
.bt-icon-btn:hover{background:var(--bt-hover);color:var(--bt-ink);transform:scale(1.08)}
.bt-icon-btn:active{transform:scale(.92)}
.bt-set-body{gap:20px}
.bt-drawer-model{display:flex;flex-direction:column}
.bt-drawer-model .bt-note{margin-top:6px}
.bt-drawer-permission{display:flex;flex-direction:column}
.bt-seg button.bt-perm-danger,.bt-seg button.bt-perm-danger[aria-pressed=true],.bt-kv span.bt-perm-danger{color:var(--bt-danger)}

/* Settings dialog: a 198px page list beside the page. */
.bt-settings-layer{position:fixed;inset:var(--bt-frame-chrome-top,0px) 0 0;z-index:60;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-scrim{position:absolute;inset:0;background:rgba(0,0,0,.32);animation:bt-fade .22s ease-out}
body[data-bt-dark] .bt-scrim{background:rgba(0,0,0,.5)}
.bt-settings{--bt-set-w:min(1100px,calc(100vw - 48px));--bt-set-h:min(780px,calc(100vh - 2*max(32px,var(--bt-frame-overlay-top,32px))));position:relative;width:var(--bt-set-w);height:var(--bt-set-h);background:var(--bt-main);border-radius:16px;border:.5px solid var(--bt-line-2);box-shadow:0 24px 80px rgba(0,0,0,.24);display:flex;overflow:hidden;color:var(--bt-ink);animation:bt-dialog-rise ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
:is(.bt-settings-layer,.bt-mem-layer)[data-leaving]{pointer-events:none}
:is(.bt-settings-layer,.bt-mem-layer)[data-leaving] .bt-scrim{opacity:0;transition:opacity ${DIALOG_EXIT_MS}ms ease-in}
:is(.bt-settings-layer,.bt-mem-layer)[data-leaving]>[role=dialog]{animation:bt-dialog-sink ${DIALOG_EXIT_MS}ms ${EASE_IN} forwards}
@keyframes bt-dialog-rise{from{transform:translateY(12px) scale(.96)}}
@keyframes bt-dialog-sink{to{opacity:0;transform:translateY(6px) scale(.975);filter:blur(3px)}}
@media (prefers-reduced-motion:reduce){.bt-settings,.bt-scrim,.bt-settings-page>*{animation:bt-fade .12s ease-out!important}}
.bt-settings-nav{position:relative;width:198px;flex:none;padding:16px 8px;border-right:.5px solid var(--bt-line);display:flex;flex-direction:column;gap:2px;background:var(--bt-sidebar);box-sizing:border-box}
.bt-settings-item{position:relative;z-index:1;display:flex;align-items:center;gap:8px;padding:6px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left;transition:background-color .12s ease,color .12s ease}
.bt-settings-item:hover{color:var(--bt-ink);background:var(--bt-hover)}
.bt-settings-item[aria-current=page]{background:var(--bt-active);color:var(--bt-ink)}
.bt-settings-nav>.bt-thumb{left:8px;right:8px;border-radius:8px;background:var(--bt-active)}
.bt-settings-nav[data-glide] .bt-settings-item[aria-current=page]{background:transparent}
.bt-settings-shell{margin-top:auto}
/* Usage while another page is open: out of the flow, so it keeps its layout, and not
   rendered. */
.bt-settings-usage[data-off]{position:absolute;top:0;left:198px;width:calc(var(--bt-set-w) - 198px);height:100%;box-sizing:border-box;content-visibility:hidden;pointer-events:none}
.bt-settings-main{flex:none;display:flex;flex-direction:column;min-width:0;width:calc(var(--bt-set-w) - 198px);height:var(--bt-set-h)}
.bt-settings-head{display:flex;align-items:center;gap:6px;padding:16px 56px 4px 20px}
.bt-settings-head h2{margin:0;font-size:15px;line-height:24px;font-weight:600;animation:bt-veil-in .2s ease-out}
.bt-settings-head>.bt-icon-btn{animation:bt-back-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
@keyframes bt-back-in{from{translate:6px 0;scale:.8}}
.bt-settings-scroll{flex:1;overflow-y:auto;padding:12px 20px 24px;display:flex;flex-direction:column;gap:20px;scrollbar-width:thin}
.bt-settings-page>:not(.bt-us){animation:bt-page-up ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .22s ease-out backwards}
.bt-settings-page[data-move=in]>:not(.bt-us){animation-name:bt-page-in,bt-veil-in}
.bt-settings-page[data-move=out]>:not(.bt-us){animation-name:bt-page-out,bt-veil-in}
.bt-settings-page>:nth-child(2){animation-delay:30ms}
.bt-settings-page>:nth-child(3){animation-delay:60ms}
.bt-settings-page>:nth-child(4){animation-delay:90ms}
.bt-settings-page>:nth-child(n+5){animation-delay:120ms}
@keyframes bt-page-up{from{transform:translateY(10px)}}
@keyframes bt-page-in{from{transform:translateX(18px)}}
@keyframes bt-page-out{from{transform:translateX(-18px)}}
.bt-settings-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:0;background:var(--bt-hover);color:var(--bt-ink-2);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.bt-settings-close:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-settings-form{display:flex;flex-direction:column;gap:16px}
.bt-set-section h3{font-size:13px;line-height:18px;font-weight:600;margin:0 0 8px;padding:0 4px}
.bt-set-card{border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card);display:flex;flex-direction:column}
.bt-set-card>*+*{border-top:.5px solid var(--bt-line)}
.bt-set-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:18px;text-align:left;width:100%;box-sizing:border-box;border-radius:0}
button.bt-set-row{cursor:pointer}
button.bt-set-row:hover{background:var(--bt-hover)}
.bt-set-card>.bt-set-row+.bt-set-row{border-top:.5px solid var(--bt-line)}
.bt-set-row:first-child{border-top-left-radius:12px;border-top-right-radius:12px}
.bt-set-row:last-child{border-bottom-left-radius:12px;border-bottom-right-radius:12px}
.bt-set-copy{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.bt-set-hint{font-size:12px;line-height:16px;color:color-mix(in srgb,var(--bt-ink-2) 50%,var(--bt-ink-3))}
.bt-set-control{flex:none;display:flex;align-items:center;gap:6px}
.bt-set-places .bt-set-control{flex:0 1 auto;max-width:50%;min-width:0}
.bt-set-places .bt-set-hint{overflow-wrap:anywhere}
.bt-set-value{font-size:13px;color:var(--bt-ink-2);text-align:right}
.bt-set-bot{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
.bt-set-paste{flex-direction:column;align-items:stretch;gap:8px}
.bt-chevron{color:var(--bt-ink-3);display:inline-flex;flex:none}

/* Settings → Connectors. */
.bt-connector{display:flex;flex-direction:column;gap:10px;padding:12px}
.bt-connector-head{display:flex;align-items:center;gap:12px;min-width:0}
.bt-connector-mark{flex:none;width:36px;height:36px;border-radius:10px;background:var(--bt-card);border:.5px solid var(--bt-line);display:flex;align-items:center;justify-content:center;color:var(--bt-ink)}
.bt-connector-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bt-connector-name{font-size:14px;line-height:20px;font-weight:500}
.bt-connector-status{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-connector-meta{font-size:11.5px;line-height:16px;color:var(--bt-ink-3);overflow-wrap:anywhere}
.bt-connector[data-state=needs-auth] .bt-connector-status,.bt-connector[data-state=needs-approval] .bt-connector-status{color:var(--bt-warn);white-space:normal}
.bt-connector[data-state=unavailable] .bt-connector-status{color:var(--bt-ink-2);white-space:normal}
.bt-connector[data-state=ready] .bt-connector-status{color:var(--bt-ink-2)}
.bt-connector[data-state=error] .bt-connector-status{color:var(--bt-danger);white-space:normal}
.bt-connector-actions{flex:none;display:flex;gap:6px}
.bt-connector-form{display:flex;flex-direction:column;gap:8px;padding-left:48px;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-connector-form-row{display:flex;align-items:center;gap:6px}
.bt-connector-link{flex:1;font-size:12px;color:var(--bt-ink-2)}
.bt-connector-error{padding-left:48px;font-size:12px;line-height:16px;color:var(--bt-danger)}
`

// The memory dialog.
export const MEMORY_DIALOG_CSS = `
/* Memory dialog: a summary of every entry, the entries behind the menu, "Ask or update" below. */
.bt-mem-row{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 8px 0 10px;border:.5px solid var(--bt-line-2);border-radius:10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;box-sizing:border-box;transition:background-color .12s ease}
.bt-mem-row:hover{background:var(--bt-hover)}
.bt-mem-row>svg{flex:none;color:var(--bt-ink-2)}
.bt-mem-row-copy{flex:1;text-align:left}
.bt-mem-row-go{display:inline-flex;align-items:center;gap:2px;color:var(--bt-ink-3);font-size:12px;flex:none;white-space:nowrap}
.bt-mem-layer{position:fixed;inset:var(--bt-frame-chrome-top,0px) 0 0;z-index:61;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-mem-scrim{animation:bt-fade .2s ease-out}
.bt-mem{position:relative;width:min(680px,calc(100vw - 48px));height:min(760px,calc(100vh - 2*max(32px,var(--bt-frame-overlay-top,32px))));background:var(--bt-main);border-radius:20px;border:.5px solid var(--bt-line-2);box-shadow:0 24px 80px rgba(0,0,0,.24);display:flex;flex-direction:column;overflow:hidden;color:var(--bt-ink);animation:bt-dialog-rise ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-mem-head{position:relative;display:flex;align-items:center;gap:8px;height:60px;flex:none;padding:0 14px 0 24px;border-bottom:.5px solid var(--bt-line);box-sizing:border-box}
.bt-mem-head .bt-icon-btn{width:32px;height:32px;flex:none}
.bt-mem-head [aria-haspopup] svg{width:18px;height:18px;stroke-width:2.6}
.bt-mem-head>.bt-icon-btn:first-child{margin-left:-10px}
.bt-mem-head h2{margin:0;font-size:17px;line-height:24px;font-weight:600;white-space:nowrap}
.bt-mem-status{font-size:13px;line-height:18px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums}
.bt-mem-head-gap{flex:1}
.bt-mem-menu{position:absolute;top:52px;right:50px;min-width:220px;--bt-origin:top right}
.bt-mem-menu button:disabled{opacity:.4;cursor:default;background:none}
.bt-mem-body{flex:1;overflow-y:auto;padding:22px 28px 24px;scrollbar-width:thin;display:flex;flex-direction:column;gap:12px}
.bt-mem-summary{transition:opacity .3s ease}
.bt-mem-summary[data-stale]{opacity:.55}
.bt-mem-summary h3{margin:20px 0 6px;font-size:17px;line-height:26px;font-weight:600}
.bt-mem-summary h3:first-child{margin-top:0}
.bt-mem-summary p{margin:0;font-size:15px;line-height:26px}
.bt-mem-summary>*{animation:bt-mem-line .45s cubic-bezier(.16,1,.3,1) both}
.bt-mem-summary>:nth-child(2){animation-delay:.03s}
.bt-mem-summary>:nth-child(3){animation-delay:.06s}
.bt-mem-summary>:nth-child(4){animation-delay:.09s}
.bt-mem-summary>:nth-child(5){animation-delay:.12s}
.bt-mem-summary>:nth-child(6){animation-delay:.15s}
.bt-mem-summary>:nth-child(n+7){animation-delay:.18s}
@keyframes bt-mem-line{from{opacity:0;transform:translateY(4px)}}
.bt-mem-skel{display:flex;flex-direction:column;gap:24px}
.bt-mem-skel-block{display:flex;flex-direction:column;gap:10px}
.bt-mem-skel-block span{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--bt-hover) 25%,var(--bt-active) 50%,var(--bt-hover) 75%);background-size:200% 100%;animation:bt-mem-skel 1.4s ease-in-out infinite}
.bt-mem-skel-block .bt-mem-skel-head{width:30%;height:16px;margin-bottom:2px}
@keyframes bt-mem-skel{from{background-position:150% 0}to{background-position:-50% 0}}
.bt-mem-skel-label{font-size:13px;line-height:18px;color:var(--bt-ink-3)}
.bt-mem-empty{margin:auto;max-width:400px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:24px 0;animation:bt-mem-line .45s cubic-bezier(.16,1,.3,1) both}
.bt-mem-empty-mark{width:48px;height:48px;border-radius:50%;background:var(--bt-hover);display:flex;align-items:center;justify-content:center;color:var(--bt-ink-2);margin-bottom:4px}
.bt-mem-empty-mark svg{width:22px;height:22px}
.bt-mem-empty-title{font-size:15px;line-height:22px;font-weight:600}
.bt-mem-empty-text{font-size:13px;line-height:20px;color:var(--bt-ink-2)}
.bt-mem-failed{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:var(--bt-hover);font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-mem-failed>span{flex:1;min-width:0;overflow-wrap:anywhere}
.bt-mem-entries{display:flex;flex-direction:column;gap:28px;animation:bt-page-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .22s ease-out}
.bt-mem-section-head{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
.bt-mem-section-head h3{margin:0;font-size:15px;line-height:22px;font-weight:600}
.bt-mem-section-head span{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-mem-section-head .bt-mem-size{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-mem-topic{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin:14px 0 2px 4px;font-weight:500}
.bt-mem-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.bt-mem-entry{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:.5px solid var(--bt-line);transition:opacity .2s ease}
.bt-mem-entry[data-busy]{opacity:.4}
.bt-mem-entry-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bt-mem-entry-text{font-size:14px;line-height:20px;overflow-wrap:anywhere}
.bt-mem-entry-meta{font-size:12px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.bt-mem-remove{flex:none;height:28px;min-width:28px;border-radius:999px;border:0;background:none;color:var(--bt-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0 6px;font:inherit;font-size:12px;opacity:0;transition:opacity .12s ease,background-color .12s ease,color .12s ease}
.bt-mem-entry:hover .bt-mem-remove,.bt-mem-remove:focus-visible,.bt-mem-remove[data-confirm]{opacity:1}
.bt-mem-remove:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-mem-remove[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--bt-danger);padding:0 10px}
@media (hover:none){.bt-mem-remove{opacity:1}}
.bt-mem-none{font-size:13px;line-height:18px;color:var(--bt-ink-3);padding:8px 4px}
.bt-mem-foot{flex:none;padding:8px 20px 20px;display:flex;flex-direction:column;gap:10px}
.bt-mem-reply{border-radius:16px;background:var(--bt-hover);padding:8px 8px 12px 16px;display:flex;flex-direction:column;gap:6px;max-height:36vh;overflow-y:auto;scrollbar-width:thin;transform-origin:50% 100%;animation:bt-pop-lift ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},bt-veil-in .2s ease-out}
.bt-mem-reply-head{display:flex;align-items:center;gap:8px;min-height:24px}
.bt-mem-reply-asked{flex:1;min-width:0;font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mem-reply .bt-icon-btn{width:24px;height:24px;flex:none}
.bt-mem-reply-text{font-size:14px;line-height:21px;padding-right:8px;overflow-wrap:anywhere}
.bt-mem-changes{list-style:none;margin:2px 0 0;padding:0 8px 0 0;display:flex;flex-direction:column;gap:4px}
.bt-mem-changes li{display:flex;align-items:flex-start;gap:6px;font-size:13px;line-height:18px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-mem-changes li svg{flex:none;margin-top:1px;color:var(--bt-danger);animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} .12s backwards}
.bt-mem-changes li[data-ok] svg{color:var(--bt-green)}
.bt-mem-ask{display:flex;align-items:center;gap:8px;height:52px;padding:0 8px 0 22px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-card);box-shadow:0 4px 16px rgba(0,0,0,.06);box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease}
.bt-mem-ask:focus-within{border-color:var(--bt-ink-3);box-shadow:0 4px 20px rgba(0,0,0,.1)}
.bt-mem-input{flex:1;min-width:0;border:0;background:none;outline:none;color:var(--bt-ink);font:inherit;font-size:15px;line-height:22px;padding:0}
.bt-mem-input::placeholder{color:var(--bt-ink-3)}
.bt-mem-send{flex:none;width:36px;height:36px;border-radius:50%;border:0;background:var(--bt-ink);color:var(--bt-main);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:opacity .15s ease,${spring(SPRING_TAP, 'scale')}}
.bt-mem-send:disabled{opacity:.22;cursor:default}
.bt-mem-send:not(:disabled):active{scale:.92}
.bt-mem-send>*{animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-mem-spin{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;box-sizing:border-box;animation:bt-mem-spin .7s linear infinite}
@keyframes bt-mem-spin{to{transform:rotate(360deg)}}
@media (max-width:640px){.bt-mem{width:100vw;height:100%;border-radius:0;border:0}.bt-mem-body{padding:18px 18px 20px}.bt-mem-foot{padding:8px 12px 12px}}
@media (prefers-reduced-motion:reduce){.bt-mem,.bt-mem-scrim,.bt-mem-summary>*,.bt-mem-empty,.bt-mem-reply,.bt-mem-skel-block span,.bt-mem-entries,.bt-mem-send>*,.bt-mem-changes li svg{animation:none}}

.bt-thumb{position:absolute;left:0;top:0;z-index:0;pointer-events:none;transition:opacity .14s ease}
.bt-thumb[data-hidden]{opacity:0}
[data-morph]{overflow:hidden!important}
.bt-veil{animation:bt-veil-in .22s ease-out}
.bt-with-icon{display:inline-flex;align-items:center;gap:4px}
.bt-with-icon svg{width:14px;height:14px}
.bt-tag-admin{display:inline-flex;align-items:center;gap:4px}
.bt-create-inline{padding:18px 16px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.bt-create-inline .bt-create-card{max-width:none}
.bt-panel-view>[data-move=in]{animation:bt-page-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
.bt-panel-view>[data-move=out]{animation:bt-page-out ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
.bt-panel-view>:is([data-move=in],[data-move=out]):nth-child(2){animation-delay:25ms}
.bt-panel-view>:is([data-move=in],[data-move=out]):nth-child(n+3){animation-delay:50ms}
.bt-panel-view>.bt-drawer-body[data-move=tab]{animation:bt-veil-in .2s ease-out}
.bt-drawer-name-input{animation:bt-veil-in .16s ease-out}
.bt-pop-in{display:inline-flex;animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
:is(.bt-soft,.bt-send,.bt-icon-btn,.bt-settings-close,.bt-mini,.bt-tab,.bt-nc-send,.bt-avedit-tab,.bt-shape,.bt-pick,.bt-swatch,.bt-palette-clear){transition:background-color .12s ease,color .12s ease,border-color .12s ease,opacity .12s ease,${spring(SPRING_TAP, 'scale')}}
:is(.bt-icon-btn,.bt-settings-close,.bt-nc-send,.bt-shape,.bt-swatch,.bt-color,.bt-x,.bt-q-x,.bt-palette-clear):active:not(:disabled){scale:.9}
:is(.bt-soft,.bt-send,.bt-mini,.bt-tab,.bt-avedit-tab,.bt-pick,.bt-q-submit,.bt-q-btn):active:not(:disabled){scale:.96}
:is(.bt-round,.bt-icon-btn,.bt-soft,.bt-send,.bt-nc-send,.bt-pill,.bt-head-side,.bt-connect,.bt-account,.bt-tile,.bt-tab,.bt-avedit-tab,.bt-settings-close,.bt-mem-row,.bt-mem-send,.bt-drawer-name,.bt-more,.bt-mini,.bt-q-submit,.bt-q-btn,.bt-palette-clear,.bt-pick,.bt-shape,.bt-color,.bt-swatch,.bt-state,.bt-avatar-trigger,.bt-react,.bt-react-strip button,.bt-voice-btn,.bt-voice-setup,.bt-x,.bt-secret-bot):focus-visible,.bt-swatch-custom:has(>input:focus-visible){outline:2px solid var(--bt-accent);outline-offset:2px}
:is(.bt-menu button,.bt-row,.bt-agent-sub-row,.bt-settings-item,button.bt-set-row,.bt-option,.bt-palette-row,.bt-seg button):focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
:is(.bt-input,.bt-select,.bt-textarea,.bt-drawer-name-input):focus-visible{border-color:var(--bt-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--bt-accent) 25%,transparent);outline:none}
@media (prefers-reduced-motion:reduce){.bt-thumb,.bt-panel,.bt-panel[data-leaving],[class*="_centerCol"],:is(.bt-soft,.bt-send,.bt-icon-btn,.bt-settings-close,.bt-mini,.bt-tab,.bt-nc-send,.bt-avedit-tab,.bt-shape,.bt-pick,.bt-swatch,.bt-palette-clear,.bt-round,.bt-row,.bt-tile,.bt-connect,.bt-seg button){transition:none!important}.bt-panel,.bt-panel-view>[data-move],.bt-drawer-name-input,.bt-veil,.bt-pop-in,.bt-token,.bt-drop,.bt-newchat,.bt-option-hint,.bt-connector-form,.bt-settings-head>*{animation:none!important}}`
