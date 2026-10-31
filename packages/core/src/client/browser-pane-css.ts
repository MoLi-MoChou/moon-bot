import { EASE_OUT, SPRING_SHAPE } from './motion.tsx'

export const BROWSER_CSS = `
.bt-panel{--bt-panel-view-fade:${SPRING_SHAPE.duration}ms}
.bt-ptabs{position:relative;display:flex;align-items:center;height:44px;flex:none;border-bottom:.5px solid var(--bt-line);padding:0 6px;gap:0;animation:bt-strip-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
@keyframes bt-strip-in{from{height:0;opacity:0}}
.bt-ptabs-in{position:relative;display:flex;align-items:center;gap:2px;flex:1;min-width:0;height:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:4px 2px;scroll-padding-left:48px;mask-image:linear-gradient(to right,#000,#000 calc(100% - 10px),transparent)}
.bt-ptabs-in>.bt-ptab-bot{position:sticky;left:0;z-index:2;background:var(--bt-main)}
.bt-ptabs-in>.bt-ptab-bot[aria-selected=true]{background:transparent}
.bt-ptabs-in::-webkit-scrollbar{display:none}
.bt-ptab{position:relative;z-index:1;display:inline-flex;align-items:center;gap:6px;height:32px;max-width:180px;padding:0 8px;flex:none;border:0;border-radius:9px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:color .12s ease}
.bt-ptab:hover{color:var(--bt-ink)}
.bt-ptab[aria-selected=true]{color:var(--bt-ink)}
.bt-ptab-bot{padding:0 7px}
.bt-ptab-bot .bt-mark{flex:none}
.bt-ptab-name{max-width:96px;overflow:hidden;text-overflow:ellipsis;font-weight:500;animation:bt-ptab-label .18s ease}
@keyframes bt-ptab-label{from{opacity:0;filter:blur(4px);max-width:0}}
.bt-ptab-fav{width:14px;height:14px;flex:none;border-radius:3px;object-fit:cover;color:var(--bt-ink-3)}
.bt-ptab-globe{display:inline-flex}
.bt-ptab-globe svg{width:14px;height:14px}
.bt-ptab-title{max-width:140px;overflow:hidden;text-overflow:ellipsis}
.bt-ptab-x{flex:none;width:16px;height:16px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;color:var(--bt-ink-3);opacity:0;transition:opacity .12s ease,background-color .12s ease}
.bt-ptab:hover .bt-ptab-x,.bt-ptab:focus-within .bt-ptab-x,.bt-ptab[aria-selected=true] .bt-ptab-x{opacity:1}
.bt-ptab-x:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-ptab-new{position:relative;z-index:1;flex:none;width:28px;height:32px;border:0;border-radius:9px;background:none;color:var(--bt-ink-3);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.bt-ptab-new:hover{color:var(--bt-ink)}
.bt-ptab-new svg{width:15px;height:15px}
.bt-ptab-ind{position:absolute;top:4px;bottom:4px;border-radius:9px;background:var(--bt-hover);opacity:0;pointer-events:none;z-index:0;transition:opacity .15s ease}
.bt-ptab-close{flex:none;margin-left:2px}
.bt-panel-ghost{position:absolute;top:calc(44px + var(--bt-caption-band,0px));right:0;bottom:0;overflow:hidden;pointer-events:none;z-index:2}
.bt-panel-ghost>.bt-panel-view{position:absolute;inset:0}
.bt-panel-view{flex:1;min-height:0;display:flex;flex-direction:column;animation:bt-panel-view-in .22s ${EASE_OUT}}
@keyframes bt-panel-view-in{from{opacity:0}}
/* While the panel changes width its views keep their final width on the right edge, so
   only the panel edge moves and nothing inside reflows frame by frame. */
.bt-panel[data-settling]{overflow:hidden}
.bt-panel[data-settling]>.bt-ptabs,.bt-panel[data-settling]>.bt-panel-view{flex-shrink:0;align-self:flex-end;box-sizing:border-box;width:calc(var(--bt-panel-w,380px) - .5px)}
.bt-panel-browser{position:relative}
.bt-browser-bar{position:relative;display:flex;align-items:center;gap:2px;height:52px;padding:0 10px 0 12px;flex:none;border-bottom:.5px solid var(--bt-line)}
.bt-browser-bar .bt-icon-btn:disabled{opacity:.35;cursor:default;background:none}
.bt-browser-address{flex:1;min-width:0;display:flex;align-items:center;gap:6px;height:32px;margin:0 4px;padding:0 12px;border-radius:999px;background:var(--bt-hover);border:.5px solid transparent;transition:background-color .12s ease,border-color .12s ease,box-shadow .12s ease}
.bt-browser-address:hover{background:var(--bt-active)}
.bt-browser-address[data-editing]{background:var(--bt-main);border-color:var(--bt-line-2);box-shadow:0 2px 8px -1px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)}
.bt-browser-scheme{display:inline-flex;color:var(--bt-ink-3);flex:none}
.bt-browser-scheme svg{width:14px;height:14px}
.bt-browser-address input{flex:1;min-width:0;border:0;background:none;outline:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:18px;padding:0;text-overflow:ellipsis}
.bt-browser-address input::placeholder{color:var(--bt-ink-3)}
.bt-browser-progress{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden;pointer-events:none}
.bt-browser-progress::after{content:"";position:absolute;inset:0;width:40%;background:var(--bt-accent,#4D6BFE);border-radius:2px;animation:bt-browser-load 1.1s cubic-bezier(.4,0,.2,1) infinite}
@keyframes bt-browser-load{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
.bt-browser-frame{position:relative;flex:1;min-height:0;background:var(--bt-main)}
.bt-browser-frame[data-guest]{background:#fff}
.bt-browser-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px;text-align:center;animation:bt-foot-in .3s ease}
.bt-browser-empty-title{font-size:15px;line-height:22px;font-weight:500;margin-top:6px}
.bt-browser-empty-text{max-width:300px;font-size:13px;line-height:19px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-browser-retry{margin-top:6px;height:32px;padding:0 14px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer}
.bt-browser-retry:hover{background:var(--bt-hover)}
.bt-bcards{display:flex;flex-direction:column;gap:12px}
.bt-bcard{position:relative;border:.5px solid var(--bt-line-2);border-radius:12px;overflow:hidden;background:var(--bt-main);animation:bt-bcard-in .24s ${EASE_OUT} both;transition:border-color .12s ease,box-shadow .12s ease}
@keyframes bt-bcard-in{from{opacity:0;filter:blur(4px);transform:translateY(4px)}}
.bt-bcard[data-active]{border-color:var(--bt-accent,#4D6BFE);box-shadow:0 0 0 1px var(--bt-accent,#4D6BFE)}
.bt-bcard-shot{position:relative;display:block;width:100%;aspect-ratio:16/10;border:0;background:var(--bt-hover);padding:0;cursor:pointer}
.bt-bcard-blank{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--bt-ink-3);font-size:12px}
.bt-bcard-blank svg{width:20px;height:20px}
.bt-bcard-preview{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;padding:14px 16px;text-align:left;background:linear-gradient(to bottom,var(--bt-main),var(--bt-hover));overflow:hidden}
.bt-bcard-ptitle{font-size:13px;line-height:18px;font-weight:600;color:var(--bt-ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-bcard-excerpt{font-size:12px;line-height:17px;color:var(--bt-ink-2);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.bt-bcard-row{display:flex;align-items:center;gap:7px;padding:8px 10px;min-width:0}
.bt-bcard-fav{width:14px;height:14px;flex:none;border-radius:3px;color:var(--bt-ink-3)}
.bt-bcard-row svg.bt-bcard-fav{width:14px;height:14px}
.bt-bcard-title{flex:1;min-width:0;font-size:12.5px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink)}
.bt-bcard-host{flex:none;font-size:11px;line-height:15px;color:var(--bt-ink-3);max-width:38%;overflow:hidden;text-overflow:ellipsis}
.bt-bcard-x{position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;border-radius:7px;background:color-mix(in srgb,var(--bt-main) var(--bt-glass-tint),transparent);color:var(--bt-ink-2);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;opacity:0;transition:opacity .12s ease;backdrop-filter:var(--bt-glass-filter)}
.bt-bcard:hover .bt-bcard-x,.bt-bcard:focus-within .bt-bcard-x{opacity:1}
.bt-bcard-new{display:flex;align-items:center;justify-content:center;gap:6px;height:40px;border:.5px dashed var(--bt-line-2);border-radius:12px;background:none;color:var(--bt-ink-3);font:inherit;font-size:12.5px;cursor:pointer}
.bt-bcard-new:hover{color:var(--bt-ink);border-color:var(--bt-ink-3)}
.bt-bcard-new svg{width:14px;height:14px}
.bt-browser-empty-mark{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
:is(.bt-ptab,.bt-ptab-new,.bt-ptab-x,.bt-browser-retry,.bt-bcard-shot,.bt-bcard-x,.bt-bcard-new):focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
@media (prefers-reduced-motion:reduce){.bt-ptabs,.bt-panel-view,.bt-bcard,.bt-ptab-name,.bt-browser-empty,.bt-browser-progress::after{animation:none}.bt-ptab,.bt-ptab-x,.bt-ptab-ind,.bt-browser-address,.bt-bcard,.bt-bcard-x{transition:none}}
`
