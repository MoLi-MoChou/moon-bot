import { HEAT_WEEKS, RING } from './usage-page-types.ts'

export const USAGE_CSS = `
.bt-us{--bt-us-ease:cubic-bezier(.22,1,.36,1);--bt-us-rest:color-mix(in srgb,var(--bt-ink) 30%,var(--bt-card));--bt-us-more:color-mix(in srgb,var(--bt-ink) 16%,var(--bt-card));display:flex;flex-direction:column;gap:14px;padding-bottom:4px}
.bt-us-top{position:relative;z-index:4;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.bt-us-tabs{position:relative;display:inline-flex;flex:none;padding:3px;border-radius:999px;background:var(--bt-hover)}
.bt-us-tabs button{position:relative;z-index:1;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 12px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;line-height:26px;white-space:nowrap;cursor:pointer;transition:color .15s ease}
.bt-us-tabs button svg{flex:none;width:13px;height:13px;margin-left:-2px}
.bt-us-pick{position:absolute;top:calc(100% + 8px);left:0;max-width:100%;box-sizing:border-box;padding:14px 16px 12px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);box-shadow:0 22px 50px -18px rgba(0,0,0,.32),0 2px 8px rgba(0,0,0,.05);transform-origin:24px 0;animation:bt-us-drop .2s var(--bt-us-ease)}
.bt-us-pick-quick{display:flex;gap:6px;margin-bottom:12px}
.bt-us-pick-quick button{height:26px;padding:0 11px;border:0;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.bt-us-pick-quick button:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-us-pick-quick button[aria-pressed=true]{background:color-mix(in srgb,var(--bt-accent) 14%,transparent);color:var(--bt-accent)}
.bt-us-pick-months{display:flex;flex-wrap:wrap;gap:8px 28px}
.bt-us-month{width:252px;animation:bt-us-fade .22s ease}
.bt-us-month-head{position:relative;display:flex;align-items:center;justify-content:center;height:28px;margin-bottom:4px;font-size:13px;line-height:18px;font-weight:600}
.bt-us-month-nav{position:absolute;top:0;width:28px;height:28px;padding:0;border:0;border-radius:9px;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease}
.bt-us-month-nav[data-side=left]{left:0}
.bt-us-month-nav[data-side=right]{right:0}
.bt-us-month-nav:hover:not(:disabled){background:var(--bt-hover);color:var(--bt-ink)}
.bt-us-month-nav:disabled{opacity:.3;cursor:default}
.bt-us-weekdays,.bt-us-days{display:grid;grid-template-columns:repeat(7,36px)}
.bt-us-weekdays span{height:24px;font-size:11px;line-height:24px;text-align:center;color:var(--bt-ink-3)}
.bt-us-day{position:relative;height:36px;padding:0;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer}
.bt-us-day::before{content:'';position:absolute;top:4px;bottom:4px;left:0;right:0;transition:background-color .12s ease}
.bt-us-day>b{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;font-weight:400;transition:background-color .12s ease,color .12s ease}
.bt-us-day:hover:not(:disabled)>b{background:var(--bt-hover)}
.bt-us-day[data-today]>b{color:var(--bt-accent);font-weight:600}
.bt-us-day[data-has]::after{content:'';position:absolute;z-index:2;left:50%;bottom:6px;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:var(--bt-ink-3)}
.bt-us-day[data-in]::before{background:color-mix(in srgb,var(--bt-accent) 13%,transparent)}
.bt-us-day[data-in][data-l]::before{left:4px;border-radius:14px 0 0 14px}
.bt-us-day[data-in][data-r]::before{right:4px;border-radius:0 14px 14px 0}
.bt-us-day[data-in][data-l][data-r]::before{border-radius:14px}
.bt-us-day[data-in][data-start]::before{left:50%;border-radius:0}
.bt-us-day[data-in][data-end]::before{right:50%;border-radius:0}
.bt-us-day[data-in][data-start][data-r]::before,.bt-us-day[data-in][data-end][data-l]::before,.bt-us-day[data-in][data-start][data-end]::before{display:none}
.bt-us-day[data-start]>b,.bt-us-day[data-end]>b,.bt-us-day[data-start]:hover>b,.bt-us-day[data-end]:hover>b{background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font-weight:600}
.bt-us-day[data-start][data-has]::after,.bt-us-day[data-end][data-has]::after{background:color-mix(in srgb,var(--bt-accent-ink,#fff) 75%,transparent)}
.bt-us-day:disabled{color:var(--bt-ink-3);opacity:.45;cursor:default}
.bt-us-pick-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:8px;padding-top:10px;border-top:1px solid var(--bt-line);font-size:12px;line-height:16px;color:var(--bt-ink-3);white-space:nowrap}
.bt-us-pick-foot b{color:var(--bt-ink);font-weight:500}
.bt-us-tabs button:hover,.bt-us-tabs button[aria-pressed=true]{color:var(--bt-ink)}
.bt-us-tabs:not([data-glide]) button[aria-pressed=true]{background:var(--bt-card)}
.bt-us-tabs>.bt-thumb{top:3px;bottom:3px;border-radius:999px;background:var(--bt-card);box-shadow:0 1px 3px rgba(0,0,0,.08),0 0 0 .5px var(--bt-line-2)}
.bt-us-note{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-us-note::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--bt-accent);animation:bt-us-pulse 1.4s ease-in-out infinite}
.bt-us-sheet{display:flex;flex-direction:column;gap:4px}
.bt-us-sheet>.bt-us-stats,.bt-us-sheet>.bt-us-card,.bt-us-sheet>.bt-us-pair>.bt-us-card{border-radius:0}
.bt-us-sheet>:first-child{border-radius:16px 16px 0 0}
.bt-us-sheet>:last-child{border-radius:0 0 16px 16px}
.bt-us-stats{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;border-radius:16px;border:1px solid var(--bt-line);background:var(--bt-card);animation:bt-us-in .45s var(--bt-us-ease) backwards}
.bt-us-stat{display:flex;flex-direction:column;justify-content:flex-end;gap:6px;min-width:0;padding:16px 18px}
.bt-us-stat+.bt-us-stat{border-left:1px solid var(--bt-line)}
.bt-us-stat-label{overflow:hidden;font-size:12px;line-height:16px;color:var(--bt-ink-3);white-space:nowrap;text-overflow:ellipsis}
.bt-us-stat-value{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-us-stat-main .bt-us-stat-value{font-size:34px;line-height:40px;letter-spacing:-.025em}
.bt-us-stat-value small{font-size:13px;font-weight:400;letter-spacing:0;color:var(--bt-ink-3)}
.bt-us-delta{align-self:center;margin-left:2px;padding:0 8px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-ink-2);font-size:11px;line-height:20px;font-weight:500;letter-spacing:0}
.bt-us-card{display:flex;flex-direction:column;gap:12px;min-width:0;padding:14px 18px 16px;border-radius:16px;border:1px solid var(--bt-line);background:var(--bt-card);animation:bt-us-in .45s var(--bt-us-ease) backwards;animation-delay:calc(var(--i,0) * 45ms)}
.bt-us-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px}
.bt-us-card-head h3{display:flex;align-items:baseline;gap:8px;min-width:0;margin:0;font-size:13px;line-height:18px;font-weight:600}
.bt-us-card-head h3 span,.bt-us-head-note{font-size:12px;font-weight:400;color:var(--bt-ink-3)}
.bt-us-chart-body{display:flex;flex-direction:column;gap:8px;padding-top:6px}
.bt-us-plot{position:relative;height:200px;margin-left:40px}
.bt-us-grid{position:absolute;left:0;right:0;border-top:1px dashed var(--bt-line-2);pointer-events:none}
.bt-us-grid.bt-us-base{border-top:1px solid var(--bt-line-2)}
.bt-us-grid span{position:absolute;right:calc(100% + 8px);top:-8px;font-size:10px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-us-cols{position:absolute;inset:0;display:flex;align-items:flex-end}
.bt-us-col{position:relative;flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center}
.bt-us-stack{display:flex;flex-direction:column-reverse;gap:2px;width:56%;min-width:4px;max-width:28px;transform-origin:50% 100%;animation:bt-us-grow .6s var(--bt-us-ease) backwards;animation-delay:calc(var(--i,0) * 14ms);transition:height .45s var(--bt-us-ease),opacity .18s ease}
.bt-us-stack>i{flex:1 1 0;min-height:2px;border-radius:5px;transition:flex-grow .45s var(--bt-us-ease)}
.bt-us-plot[data-hover] .bt-us-col:not([data-on]) .bt-us-stack{opacity:.3}
.bt-us-stub{width:4px;height:4px;margin-bottom:-2px;border-radius:50%;background:var(--bt-line-2)}
.bt-us-ticks{display:flex;margin-left:40px;font-size:11px;line-height:14px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.bt-us-ticks span{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap}
.bt-us-ticks span[data-now]{color:var(--bt-ink);font-weight:500}
.bt-us-tip{position:absolute;top:6px;z-index:3;min-width:160px;max-width:240px;padding:10px 12px;border-radius:12px;border:.5px solid var(--bt-line-2);background:color-mix(in srgb,var(--bt-card) 90%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 14px 34px -12px rgba(0,0,0,.28);font-size:12px;line-height:16px;pointer-events:none;animation:bt-us-pop .16s var(--bt-us-ease)}
.bt-us-tip-title{color:var(--bt-ink-3)}
.bt-us-tip-total{margin:2px 0 8px;font-size:15px;line-height:20px;font-weight:600;font-variant-numeric:tabular-nums}
.bt-us-tip-total:last-child{margin-bottom:0}
.bt-us-tip-row{display:flex;align-items:center;gap:8px;color:var(--bt-ink-2)}
.bt-us-tip-row+.bt-us-tip-row{margin-top:5px}
.bt-us-tip-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-us-tip-row b{font-weight:500;color:var(--bt-ink);font-variant-numeric:tabular-nums}
.bt-us-legend{display:flex;flex-wrap:wrap;gap:6px}
.bt-us-key{display:inline-flex;align-items:center;gap:6px;min-width:0;height:24px;padding:0 10px 0 8px;border:0;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2);font:inherit;font-size:12px;line-height:24px}
button.bt-us-key{cursor:pointer;transition:background-color .12s ease,color .12s ease}
button.bt-us-key:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-us-dot{flex:none;width:8px;height:8px;border-radius:50%}
.bt-us-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:4px}
.bt-us-rows{display:flex;flex-direction:column;margin:0 -8px}
.bt-us-row{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:8px;border:0;border-radius:12px;background:none;color:var(--bt-ink);font:inherit;text-align:left;animation:bt-us-in .4s var(--bt-us-ease) backwards;animation-delay:calc(var(--i,0) * 35ms + 90ms)}
button.bt-us-row{cursor:pointer;transition:background-color .12s ease}
button.bt-us-row:hover{background:var(--bt-hover)}
.bt-us-row-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px}
.bt-us-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.bt-us-row-line{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:13px;line-height:18px}
.bt-us-row-name{flex:0 1 auto;min-width:0;overflow:hidden;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.bt-us-row-sub{flex:0 1 auto;min-width:0;overflow:hidden;font-size:12px;color:var(--bt-ink-3);text-overflow:ellipsis;white-space:nowrap}
.bt-us-track{display:block;height:4px;border-radius:999px;background:var(--bt-hover);overflow:hidden}
.bt-us-track>span{display:block;height:100%;border-radius:inherit;transform-origin:0 50%;animation:bt-us-fill .7s var(--bt-us-ease) backwards;animation-delay:calc(var(--i,0) * 35ms + 140ms);transition:width .45s var(--bt-us-ease)}
.bt-us-row-num{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:52px;font-variant-numeric:tabular-nums}
.bt-us-row-num b{font-size:13px;line-height:18px;font-weight:600}
.bt-us-row-num small{font-size:11px;line-height:14px;color:var(--bt-ink-3)}
.bt-us-split{height:1px;margin:6px 8px;background:var(--bt-line)}
.bt-us-none{padding:18px 8px;font-size:12px;color:var(--bt-ink-3);text-align:center}
.bt-us-glyph{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bt-hover);color:var(--bt-ink-2)}
.bt-us-model{display:inline-flex;align-items:center;justify-content:center;border-radius:30%;font-weight:600;line-height:1}
.bt-us-profile{display:flex;align-items:center;gap:20px;padding:6px 4px 2px;animation:bt-us-in .45s var(--bt-us-ease) backwards}
.bt-us-ring{position:relative;flex:none;width:96px;height:96px}
.bt-us-ring>svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.bt-us-ring>svg circle{fill:none;stroke-width:4}
.bt-us-ring-track{stroke:var(--bt-line)}
.bt-us-ring-arc{stroke-linecap:round;transition:stroke-dasharray .6s var(--bt-us-ease);animation:bt-us-ring 1s var(--bt-us-ease) .1s backwards}
.bt-us-ring-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.bt-us-profile-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.bt-us-profile-copy h3{margin:0;overflow:hidden;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.01em;text-overflow:ellipsis;white-space:nowrap}
.bt-us-profile-sub{font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-us-profile-share{font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-us-heat{gap:8px}
.bt-us-heat-months,.bt-us-heat-grid{display:grid;grid-template-columns:repeat(${HEAT_WEEKS},1fr);gap:3px}
.bt-us-heat-months{height:14px;font-size:10px;line-height:14px;color:var(--bt-ink-3)}
.bt-us-heat-months span{white-space:nowrap}
.bt-us-heat-plot{position:relative}
.bt-us-heat-grid{grid-template-rows:repeat(7,auto);grid-auto-flow:column}
.bt-us-heat-grid .bt-us-cell[data-on]{outline:1.5px solid var(--bt-ink-2);outline-offset:1px}
.bt-us-heat-tip{min-width:0;white-space:nowrap}
.bt-us-cell{position:relative;aspect-ratio:1;border-radius:3px;background:var(--bt-hover);overflow:hidden}
.bt-us-heat-grid .bt-us-cell{animation:bt-us-cell .5s var(--bt-us-ease) backwards;animation-delay:calc(var(--w,0) * 7ms + 120ms)}
.bt-us-cell>i{position:absolute;inset:0}
.bt-us-cell[data-today]{outline:1.5px solid var(--bt-ink-3);outline-offset:1px}
.bt-us-cell[data-future]{visibility:hidden}
.bt-us-heat-scale{display:flex;align-items:center;justify-content:flex-end;gap:4px;font-size:11px;line-height:14px;color:var(--bt-ink-3)}
.bt-us-heat-scale .bt-us-cell{width:10px}
.bt-us-skel{border-radius:16px;background:linear-gradient(90deg,var(--bt-hover) 0%,var(--bt-active) 50%,var(--bt-hover) 100%);background-size:200% 100%;animation:bt-us-shine 1.4s ease-in-out infinite}
.bt-us-skel-sheet>.bt-us-skel:first-child{border-radius:16px 16px 0 0}
.bt-us-skel-sheet>.bt-us-skel:not(:first-child){border-radius:0}
.bt-us-skel-sheet>.bt-us-pair>.bt-us-skel:first-child{border-radius:0 0 0 16px}
.bt-us-skel-sheet>.bt-us-pair>.bt-us-skel:last-child{border-radius:0 0 16px 0}
.bt-us-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:72px 16px;text-align:center;font-size:13px;line-height:18px;color:var(--bt-ink-3)}
.bt-us-empty b{margin-top:6px;font-size:15px;font-weight:600;color:var(--bt-ink)}
@keyframes bt-us-in{from{opacity:0;transform:translateY(6px)}}
@keyframes bt-us-grow{from{transform:scaleY(0)}}
@keyframes bt-us-fill{from{transform:scaleX(0)}}
@keyframes bt-us-pop{from{opacity:0;transform:translateY(3px) scale(.97)}}
@keyframes bt-us-drop{from{opacity:0;transform:translateY(-4px) scale(.96)}}
@keyframes bt-us-fade{from{opacity:0}}
@keyframes bt-us-cell{from{opacity:0;transform:scale(.5)}}
@keyframes bt-us-ring{from{stroke-dasharray:0 ${Math.ceil(RING)}}}
@keyframes bt-us-pulse{50%{opacity:.25}}
@keyframes bt-us-shine{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.bt-us *,.bt-us *::before{animation:none!important;transition:none!important}}
`
