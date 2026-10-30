import { SPRING_POP } from './motion.tsx'

export const ABOUT_CSS = `
.bt-app-progress{display:inline-block;width:140px;height:6px;border-radius:999px;background:var(--bt-line);overflow:hidden}
.bt-app-progress>span{display:block;height:100%;background:var(--bt-accent);transition:width .3s}
.bt-about-hero{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.bt-about-mark{flex:none;display:inline-flex;position:relative}
.bt-about-mark::before{content:'';position:absolute;inset:-20%;border-radius:50%}
body:not([data-bt-motion=quiet]) .bt-about-mark:hover .bt-mark[data-live][data-state=idle]:not(.bt-mark-poke) .bt-b{rotate:8deg;translate:5% -1%;animation:bt-nuzzle .78s ease-in-out .32s infinite}
body:not([data-bt-motion=quiet]) .bt-about-mark:hover .bt-mark[data-live][data-state=idle] .bt-eye{scale:1 0;animation:none}
body:not([data-bt-motion=quiet]) .bt-about-mark:hover .bt-mark[data-live][data-state=idle] .bt-eye-happy{opacity:1;transition-delay:.1s}
.bt-about-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bt-about-name{font-size:16px;line-height:22px;font-weight:600}
.bt-about-version{font-size:12px;line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-about-ask{margin:-10px 4px 0;font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-star{flex:none;display:inline-flex;align-items:stretch;height:30px;border-radius:999px;border:1px solid var(--bt-line-2,var(--bt-line));overflow:hidden;color:var(--bt-ink);text-decoration:none;font-size:12px;line-height:28px;transition:transform .12s ease,border-color .15s ease}
.bt-star:hover{border-color:color-mix(in srgb,#e3a008 55%,var(--bt-line))}
.bt-star:active{transform:scale(.96)}
.bt-star-main{display:inline-flex;align-items:center;gap:6px;padding:0 12px 0 10px;background:var(--bt-hover);font-weight:500}
.bt-star-icon{display:inline-flex;color:var(--bt-ink-2);transition:color .15s ease}
.bt-star-icon path{transition:fill .15s ease}
.bt-star:hover .bt-star-icon{color:#e3a008;animation:bt-star-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-star:hover .bt-star-icon path{fill:currentColor}
.bt-star-count{display:inline-flex;align-items:center;padding:0 11px;border-left:1px solid var(--bt-line-2,var(--bt-line));color:var(--bt-ink-2);font-variant-numeric:tabular-nums;animation:bt-star-count-in ${SPRING_POP.duration}ms ${SPRING_POP.easing},bt-veil-in .2s ease-out}
@keyframes bt-star-pop{from{scale:.6;rotate:-30deg}}
@keyframes bt-star-count-in{from{translate:-6px 0}}
.bt-about-link{display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.bt-about-link svg{width:14px;height:14px}
.bt-fb-primary:disabled{opacity:.6;cursor:default;filter:none}
@media (prefers-reduced-motion:reduce){.bt-star:hover .bt-star-icon,.bt-star-count{animation:none}}
`
