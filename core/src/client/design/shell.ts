// The shell's own frame: the sidebar column and its rows, the floating header pill,
// the team-view overrides on the host shell's chrome (sidebar switch, footer seats),
// the voice pane, and the connection notice.
import { LOGO_DARK, LOGO_LIGHT } from '../brand-art.ts'
import { spring, SPRING_POP, SPRING_SHAPE, SPRING_STRETCH, SPRING_TAP } from '../motion.tsx'

// A sidebar skin may seat the host's footer outlets in a footer of its own; matching the
// outlets keeps that footer on one row whatever the skin names its boxes. The shell's
// own footer is left to the _footArea rules, which lay it out differently.
const SKIN_FOOT = ':is(div,footer):not([class*="_footArea"]):has(> div > [data-slot="sidebar.footer.action"] > .bt-connect-wrap)'

// The sidebar column, its lists and rows, and the floating header pill.
export const SHELL_FRAME_CSS = `
.bt-side{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:2px;padding:0 12px 8px 0;color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-side-top{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:6px 5px 0 0}
.bt-brand{display:inline-flex;align-items:center;gap:6px;margin-right:auto;padding:4px 8px 4px 4px;border:0;border-radius:8px;background:none;cursor:pointer;font-family:inherit;font-size:15px;line-height:20px;font-weight:600;letter-spacing:-.01em;color:var(--bt-ink);white-space:nowrap}
.bt-brand-whale{display:inline-flex;color:var(--bt-accent)}
.bt-moon-mark{display:inline-block;flex:none;background:url("${LOGO_LIGHT}") center/contain no-repeat}
body[data-bt-dark] .bt-moon-mark{background-image:url("${LOGO_DARK}")}
.bt-round{width:36px;height:36px;border-radius:50%;border:1px solid var(--bt-line);background:var(--bt-main);color:var(--bt-ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background-color .12s ease,transform .12s ease}
.bt-round:hover{background:var(--bt-hover)}
.bt-round:active{transform:scale(.94)}
.bt-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;min-height:0;flex:1 1 auto}
/* Scroll-edge fade: an edge fades only while there is more list past it (after
   open-claude-ui's ScrollFadeContainer, MIT). Browsers without scroll timelines get none. */
@property --bt-fade-top{syntax:'<length>';inherits:false;initial-value:0px}
@property --bt-fade-bottom{syntax:'<length>';inherits:false;initial-value:0px}
@supports (animation-timeline:scroll()){
.bt-list,.bt-process ol{mask-image:linear-gradient(to bottom,transparent 0,#000 var(--bt-fade-top),#000 calc(100% - var(--bt-fade-bottom)),transparent 100%);animation:bt-edge-fade linear both;animation-timeline:scroll(self)}
@keyframes bt-edge-fade{0%{--bt-fade-top:0px;--bt-fade-bottom:24px}8%,92%{--bt-fade-top:20px;--bt-fade-bottom:24px}100%{--bt-fade-top:20px;--bt-fade-bottom:0px}}
}
.bt-tile-wrap{display:flex;justify-content:center;padding:20px 0 15px}
.bt-tile{display:flex;flex-direction:column;align-items:center;gap:4px;width:95px;padding:6px 8px 4px;border-radius:12px;border:0;background:transparent;color:var(--bt-ink);cursor:pointer;font-family:inherit;transition:background-color .12s ease}
.bt-tile:hover{background:var(--bt-hover)}
.bt-tile[aria-current=page]{background:var(--bt-active)}
.bt-tile-role{margin-top:2px;font-size:11.5px;line-height:18px;padding:1px 9px;border-radius:999px;border:0;background:var(--bt-tag-bg);color:var(--bt-tag-ink);font-weight:500;letter-spacing:.01em;max-width:none}
.bt-tile{width:auto!important;min-width:104px;padding:8px 12px 8px!important}
.bt-tile-busy{display:inline-flex;align-items:center;gap:6px;margin-top:2px;font-size:11.5px;line-height:18px;padding:1px 9px;border-radius:999px;background:color-mix(in srgb,var(--bt-accent) 14%,transparent);color:var(--bt-accent);font-weight:500}
.bt-tile-busy .bt-dots i,.bt-row-busy .bt-dots i{background:currentColor}
.bt-row-busy{display:inline-flex!important;align-items:center;gap:6px;color:var(--bt-accent)!important}
.bt-busy>.bt-mark,.bt-busy>.bt-cluster{position:relative}
.bt-busy>.bt-mark::after{content:"";position:absolute;inset:-4px;box-sizing:border-box;border-radius:50%;border:2px solid transparent;border-top-color:var(--bt-accent);border-right-color:color-mix(in srgb,var(--bt-accent) 40%,transparent);animation:bt-busy-spin 1.1s linear infinite;pointer-events:none}
/* Moon Bot's sprite carries its face low and its horn high, so a ring on the square box
   sits above the face and its lower half hangs in the air. This ring rides the face, and
   the sprite's own silhouette in front of it lets the horn cross without a seam. */
.bt-busy>.bt-mark:has(> .bt-mark[data-shape=moonbot]){isolation:isolate}
.bt-busy>.bt-mark:has(> .bt-mark[data-shape=moonbot])::after{inset:auto;z-index:-1;left:calc(var(--bt-size,36px) * .11 - 4px);top:calc(var(--bt-size,36px) * .214 - 4px);width:calc(var(--bt-size,36px) * .78 + 8px);height:calc(var(--bt-size,36px) * .78 + 8px)}
.bt-busy .bt-mark[data-shape=moonbot]:not([data-state=idle]):not([data-state=done]) .bt-b{animation-name:bt-sway}
/* The working dot rides the face's lower-right edge, not the empty corner of the box. */
.bt-busy>.bt-mark:has(> .bt-mark[data-shape=moonbot])>.bt-badge-working{right:calc(var(--bt-size,36px) * .22 - 4px);bottom:calc(var(--bt-size,36px) * .12 - 4px)}
@keyframes bt-busy-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.bt-busy>.bt-mark::after{animation:none}}
.bt-tile-name{font-size:13px;line-height:18px;font-weight:400;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-chip{font-size:11px;line-height:16px;padding:1px 4px;border-radius:4px;background:var(--bt-hover);border:1px solid var(--bt-line);color:var(--bt-ink-2);white-space:nowrap;max-width:84px;overflow:hidden;text-overflow:ellipsis}
.bt-row{display:flex;align-items:center;gap:8px;min-height:54px;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--bt-ink);text-align:left;cursor:pointer;width:100%;box-sizing:border-box;font-family:inherit;transition:background-color .12s ease}
.bt-row:hover{background:var(--bt-hover)}
.bt-row[aria-current=page]{background:var(--bt-active)}
.bt-row-body{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.bt-row-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;line-height:20px;font-weight:400}
.bt-row-title{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-tag{flex:none;max-width:96px;font-size:12px;line-height:16px;font-weight:400;padding:1px 6px;border-radius:4px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-row-preview{font-size:13px;line-height:18px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-unread{width:8px;height:8px;border-radius:50%;background:var(--bt-accent);flex:none;margin-right:2px;animation:bt-fade .13s cubic-bezier(.22,1,.36,1)}
.bt-unread-wait{background:var(--bt-star)}
.bt-rail{align-items:center;padding:0 0 8px}
.bt-rail .bt-row{justify-content:center;padding:6px 0;min-height:44px}
.bt-side-foot{display:flex;padding-top:8px}
.bt-connect{flex:1;height:36px;border-radius:999px;border:1px solid var(--bt-line);background:var(--bt-main);color:var(--bt-ink);font-family:inherit;font-size:14px;line-height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background-color .12s ease}
.bt-connect:hover{background:var(--bt-hover)}
.bt-connect svg{flex:none;width:15px;height:15px}
.bt-connect-wrap{position:relative;display:flex;flex:1 1 auto;min-width:0}

.bt-head{position:relative;display:flex;justify-content:center;align-items:center;height:40px;flex:none;pointer-events:none}
.bt-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:40px;padding:7.5px 13.5px 7.5px 7.5px;border-radius:999px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 2px 8px -1px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);color:var(--bt-ink);font-family:inherit;font-size:14px;line-height:20px;cursor:pointer;max-width:70%;box-sizing:border-box;transition:background-color .12s ease,transform ${SPRING_TAP.duration}ms ${SPRING_TAP.easing}}
.bt-pill:hover{background:color-mix(in srgb,var(--bt-main),#777 9%)}
.bt-head-side{position:absolute;right:12px;top:4px;width:32px;height:32px;border-radius:8px;pointer-events:auto;transition:background-color .12s ease}
.bt-head-side:hover{background:color-mix(in srgb,var(--bt-main),#777 12%);color:var(--bt-ink)}
.bt-pill:active{transform:scale(.965)}
.bt-pill-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.bt-pill-mem{flex:none;display:inline-flex;width:0;margin-left:-8px;overflow:hidden;transition:${spring(SPRING_SHAPE, 'width', 'margin-left')}}
.bt-pill[data-memory=updated] .bt-pill-mem{width:var(--bt-mem-w);margin-left:0;transition:${spring(SPRING_STRETCH, 'width', 'margin-left')}}
.bt-pill-mem-in{flex:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;color:var(--bt-ink-2);font-size:13px;font-weight:500;opacity:0;filter:blur(6px);transform:translateX(-8px);transition:opacity .14s ease,filter .18s ease,${spring(SPRING_SHAPE, 'transform')}}
.bt-pill-mem-in::before{content:"";flex:none;width:1px;height:14px;margin-right:4px;background:var(--bt-line-2)}
.bt-pill[data-memory=updated] .bt-pill-mem-in{opacity:1;filter:none;transform:none;transition-delay:70ms}
.bt-pill-mem-ico{flex:none;display:inline-flex;width:16px;height:16px;color:var(--bt-accent)}
.bt-pill-mem-ico svg{width:16px;height:16px}
.bt-pill[data-memory=updated] .bt-pill-mem-ico{animation:bt-mem-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} 90ms both}
@keyframes bt-mem-pop{from{transform:scale(.4) rotate(-14deg)}to{transform:none}}
.bt-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){.bt-pill-mem,.bt-pill-mem-in{transition:none!important}.bt-pill-mem-in{filter:none;transform:none}.bt-pill[data-memory=updated] .bt-pill-mem-ico{animation:none}}
.bt-swap{color:var(--bt-ink-3);font-size:12px}
.bt-pill-go{flex:none;display:inline-flex;align-items:center;justify-content:flex-end;width:0;margin-left:-8px;overflow:hidden;opacity:0;filter:blur(6px);transform:translateX(-6px);color:var(--bt-ink-2);transition:width ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},margin-left ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},transform ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing},opacity .18s ease,filter .18s ease}
.bt-pill-go svg{flex:none;transition:transform ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-pill:hover .bt-pill-go,.bt-pill:focus-visible .bt-pill-go,.bt-pill[aria-expanded=true] .bt-pill-go{width:18px;margin-left:0;opacity:1;filter:none;transform:none}
.bt-pill[aria-expanded=true] .bt-pill-go svg{transform:rotate(180deg)}
.bt-pill[data-memory=updated]:is(:hover,:focus-visible,[aria-expanded=true]) .bt-pill-go{width:0;margin-left:-8px;opacity:0;filter:blur(6px);transform:translateX(-6px)}
@media (prefers-reduced-motion:reduce){.bt-pill,.bt-pill-go,.bt-pill-go svg{transition:none!important}.bt-pill-go{filter:none}.bt-pill:active{transform:none}}`

// The team view's reshape of the host shell's chrome, then the voice pane.
export const SHELL_CHROME_CSS = `
/* Shell chrome reshaped for the team view. Selectors use stable data attributes where the
   shell offers them and CSS-module name suffixes elsewhere. */
[class*="_newSession"],nav[class*="_panelList"],[class*="_logoRow"]>[class*="_brand"],[class*="_logoRow"]:not(:has([class*="_toggle"])){display:none!important}
/* The shell's sidebar switch stays where the shell puts it whenever the sidebar is
   collapsed: on the rail, or fixed in a Windows title bar, where it also stays while
   the sidebar is open. Elsewhere an open sidebar uses the team's own top row. */
html:not([data-windows-titlebar]) :not([class*="_collapsed"])>[class*="_logoRow"]{display:none!important}
html[data-windows-titlebar] :not([class*="_collapsed"])>[class*="_logoRow"]{height:0!important;margin:0!important}
html[data-windows-titlebar] .bt-side-collapse,html[data-platform=darwin] .bt-side-collapse{display:none}
/* The footer ends in the Bot row: the whale's settings seat, then Connect plugins. Every
   other plugin's entry takes a whole row above it, in the shell's order, so none of them
   squeezes the Bot row. */
[class*="_footArea"]{grid-template-columns:auto minmax(0,1fr);grid-auto-flow:row dense;align-items:center;gap:4px 9px;padding:8px 6px 6px!important}
/* the host hides the footer of a collapsed sidebar under a Windows title bar; the grid
   stays out of that one place. */
html:not([data-windows-titlebar]) [class*="_footArea"],:not([class*="_collapsed"])>[class*="_footArea"]{display:grid!important}
[class*="_footArea"]>[class*="_footerActions"],[class*="_footArea"]>[class*="_footerActions"]>div{display:contents!important}
[class*="_footArea"]>[class*="_footerActions"]>div>*{grid-column:1/-1}
[class*="_footArea"]>[class*="_footerActions"]>div>.bt-connect-wrap{grid-column:2;order:1}
[class*="_footArea"]>[class*="_settingsArea"]{grid-column:1;order:1;width:auto!important}
[class*="_footArea"] button[aria-label="Settings"]{width:auto!important;padding:0!important;background:none!important;border-radius:50%!important;height:auto!important}
${SKIN_FOOT}{display:flex!important;flex-direction:row!important;align-items:center!important;gap:9px!important}
${SKIN_FOOT}>div:has(> [data-slot="sidebar.footer.action"]){display:flex!important;align-items:center!important;flex:1 1 auto!important;min-width:0!important}
${SKIN_FOOT}>div:has(> [data-slot="sidebar.settings"]){order:-1!important;flex:none!important;width:auto!important}
[class*="_widthHandle"]{display:none!important}

.bt-voice-pane{flex-direction:column;align-items:center;justify-content:center;animation:bt-fade .2s ease-out}
.bt-voice-stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;max-width:560px;text-align:center}
.bt-voice-orb{position:relative;width:200px;height:200px;display:grid;place-items:center;margin-bottom:8px}
.bt-voice-ring{position:absolute;inset:34px;border-radius:50%;background:var(--bt-hover);transform:scale(calc(1 + var(--bt-level,0) * .55));transition:transform .08s linear}
.bt-voice-ring-2{inset:14px;background:none;box-shadow:inset 0 0 0 1px var(--bt-line-2);transform:scale(calc(.94 + var(--bt-level,0) * .3));opacity:.8}
.bt-voice-stage[data-phase=thinking] .bt-voice-ring{animation:bt-voice-breathe 1.6s ease-in-out infinite}
.bt-voice-stage[data-phase=speaking] .bt-voice-ring{animation:bt-voice-speak .9s ease-in-out infinite}
@keyframes bt-voice-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes bt-voice-speak{0%,100%{transform:scale(1.04)}30%{transform:scale(1.2)}60%{transform:scale(1.1)}}
.bt-voice-orb>.bt-mark{position:relative}
.bt-voice-name{font-size:16px;line-height:22px;font-weight:500}
.bt-voice-status{font-size:13px;line-height:18px;color:var(--bt-ink-2);min-height:18px}
.bt-voice-caption{min-height:44px;font-size:15px;line-height:22px;color:var(--bt-ink);animation:bt-blur-in .25s ease-out;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.bt-voice-note{font-size:12px;color:var(--bt-danger)}
.bt-voice-setup{height:32px;padding:0 14px;border-radius:16px;border:0;background:var(--bt-hover);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;transition:background-color .15s ease}
.bt-voice-setup:hover{background:var(--bt-active)}
.bt-voice-bar{display:flex;gap:16px;padding:0 0 32px}
.bt-voice-btn{position:relative;width:52px;height:52px;border-radius:50%;border:0;background:var(--bt-hover);color:var(--bt-ink);display:grid;place-items:center;cursor:pointer;transition:background-color .15s ease,transform .12s ease}
.bt-voice-btn:hover{background:var(--bt-active)}
.bt-voice-btn:active{transform:scale(.94)}
.bt-voice-btn[aria-pressed=true]{background:var(--bt-user);color:var(--bt-user-ink)}
.bt-voice-slash{position:absolute;width:24px;height:2px;border-radius:1px;background:currentColor;transform:rotate(-45deg)}
.bt-voice-end{background:#ff3e51;color:#fff}
.bt-voice-end:hover{background:#e02135}
@keyframes bt-fade{from{opacity:0}to{opacity:1}}
@keyframes bt-blur-in{from{opacity:0;filter:blur(2px)}to{opacity:1;filter:blur(0)}}
@media (prefers-reduced-motion:reduce){.bt-voice-pane,.bt-voice-caption,.bt-voice-ring{animation:none!important}}`

// The stale-connection notice.
export const SHELL_NOTICE_CSS = `
/* The connection notice: a lost poll leaves the page stale, and the window says so at the
   top until a poll succeeds again. */
.bt-reconnect{position:fixed;top:12px;left:50%;translate:-50% 0;z-index:60;max-width:min(90vw,560px);padding:7px 14px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);border:1px solid var(--bt-line);box-shadow:0 6px 18px color-mix(in srgb, var(--bt-ink) 16%, transparent);font-size:12.5px;line-height:18px;text-align:center}`
