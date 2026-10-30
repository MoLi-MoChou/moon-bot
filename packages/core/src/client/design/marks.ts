// The Bot mark system: the mark, its badges and clusters, and the state, petting and
// fidget animation they share. Every shape on screen wears these rules, so this sheet
// stays with the shell marks.

// Marks, badges, clusters and stacks, with the idle/lively motion levels.
export const MARKS_CSS = `
.bt-mark{display:inline-block;flex:none;position:relative;line-height:0}
.bt-mark svg{width:100%;height:100%;overflow:visible}
.bt-mark-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;box-shadow:inset 0 0 0 1px var(--bt-line)}
.bt-mark .bt-b,.bt-mark .bt-eye,.bt-mark .bt-eyes,.bt-mark .bt-gaze{transform-box:fill-box}
.bt-mark .bt-b{transform-origin:50% 100%}
.bt-mark[data-shape=moonbot] .bt-b{transform-origin:50% 60.4%}
.bt-mark .bt-eye,.bt-mark .bt-eyes{transform-origin:center}
/* Motion levels (Settings → Bots → Animation) set body[data-bt-motion]: quiet moves a
   mark only for its state; normal, the default, adds petting, pokes and eyes that follow
   the pointer; lively adds blinks and fidgets at rest and a question riding on the head. */
body[data-bt-motion=lively] .bt-mark[data-live]:is([data-state=idle],[data-state=alert]) .bt-eye{animation:bt-blink-idle 5s linear infinite;animation-delay:var(--bt-delay,0s)}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle]:is([data-fidget=hop],[data-fidget=sway],[data-fidget=stretch]) :is(.bt-b,.bt-mark-img){animation:var(--bt-fidget) 9s ease-in-out var(--bt-fidget-delay,0s) infinite}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=hop]{--bt-fidget:bt-fidget-hop}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=sway]{--bt-fidget:bt-fidget-sway}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=stretch]{--bt-fidget:bt-fidget-stretch}
body[data-bt-motion=lively] .bt-mark[data-live][data-state=idle][data-fidget=look] .bt-eyes{animation:bt-fidget-look 9s ease-in-out var(--bt-fidget-delay,0s) infinite}
@keyframes bt-fidget-hop{0%,8%,100%{transform:none}3%{transform:translateY(-10%) scale(.97,1.04)}5.5%{transform:translateY(0) scale(1.05,.95)}}
@keyframes bt-fidget-sway{0%,10%,100%{transform:none}2.5%{transform:rotate(-8deg)}5%{transform:rotate(7deg)}7.5%{transform:rotate(-3deg)}}
@keyframes bt-fidget-stretch{0%,9%,100%{transform:none}4%{transform:scale(.94,1.08)}7%{transform:scale(1.03,.97)}}
@keyframes bt-fidget-look{0%,22%,100%{transform:none}3%,9%{transform:translateX(-14%)}12%,19%{transform:translateX(14%)}}
body[data-bt-motion=lively] .bt-badge-alert{right:auto;bottom:auto;left:50%;top:calc(var(--bt-size,36px) * -.14);translate:-50% 0;animation:bt-q-ride 1.3s cubic-bezier(.3,.7,.4,1) infinite}
body[data-bt-motion=lively] :is(.bt-row,.bt-tile)>.bt-mark:hover .bt-badge-alert{animation:none}
@keyframes bt-q-ride{0%,55%,100%{transform:translateY(0)}20%{transform:translateY(calc(var(--bt-size,36px) * -.14))}40%{transform:translateY(0)}}
/* Petting: with the pointer on a sidebar avatar or just around it (a ring a fifth of its
   size wide), a resting mark leans into the pointer and keeps nuzzling it, its eyes
   closed in a happy arc, and springs back when the pointer leaves. */
:is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster)::before{content:'';position:absolute;inset:-20%;border-radius:50%}
.bt-mark[data-live] .bt-b,.bt-mark[data-live] .bt-mark-img{transition:rotate .5s cubic-bezier(.34,1.56,.64,1),translate .5s cubic-bezier(.34,1.56,.64,1),scale .3s ease-out}
.bt-mark[data-live] .bt-eye{transition:scale .14s ease-in}
.bt-mark[data-live] .bt-eye-happy{transition:opacity .12s ease-out}
body:not([data-bt-motion=quiet]) :is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster):hover .bt-mark[data-live]:is([data-state=idle],[data-state=alert]):not(.bt-mark-poke) :is(.bt-b,.bt-mark-img){rotate:8deg;translate:5% -1%;animation:bt-nuzzle .78s ease-in-out .32s infinite}
body:not([data-bt-motion=quiet]) :is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster):hover .bt-mark[data-live]:is([data-state=idle],[data-state=alert]) .bt-eye{scale:1 0;animation:none}
body:not([data-bt-motion=quiet]) :is(.bt-row,.bt-tile)>:is(.bt-mark,.bt-cluster):hover .bt-mark[data-live]:is([data-state=idle],[data-state=alert]) .bt-eye-happy{opacity:1;transition-delay:.1s}
@keyframes bt-nuzzle{50%{rotate:14deg;translate:8% -3%;scale:1.03 .97}}
.bt-mark[data-gaze] .bt-b{translate:calc(var(--bt-gx,0) * 5%) calc(var(--bt-gy,0) * 4%);transition:translate .18s ease-out}
.bt-mark[data-gaze] .bt-gaze{transform:translate(calc(var(--bt-gx,0) * 12%),calc(var(--bt-gy,0) * 11%));transition:transform .18s ease-out}
body[data-bt-motion=quiet] .bt-mark[data-gaze] .bt-b{translate:none}
body[data-bt-motion=quiet] .bt-mark[data-gaze] .bt-gaze{transform:none}
.bt-mark[data-state=thinking] .bt-b{animation:bt-ponder 2.2s ease-in-out infinite}
.bt-mark[data-state=thinking] .bt-eyes{animation:bt-squint 2.2s ease-in-out infinite}
.bt-mark[data-state=searching] .bt-b{animation:bt-seek 1s ease-in-out infinite}
.bt-mark[data-state=searching] .bt-eyes{animation:bt-scan 1.6s ease-in-out infinite}
.bt-mark[data-state=working] .bt-b{animation:bt-bob 1.6s ease-in-out infinite}
.bt-mark[data-state=working]:is([data-shape=star],[data-shape=hex],[data-shape=plus],[data-shape=gem],[data-shape=magnet],[data-shape=ring]) .bt-b{animation:bt-wiggle 1.4s ease-in-out infinite;transform-origin:50% 50%}
.bt-mark[data-state=working]:is([data-shape=gumdrop],[data-shape=peanut],[data-shape=cushion],[data-shape=squircle],[data-shape=moon],[data-shape=wave]) .bt-b{animation:bt-squash 1.2s ease-in-out infinite}
.bt-mark[data-state=working] .bt-eye{animation:bt-blink 2.4s ease-in-out infinite}
.bt-mark[data-state=sending] .bt-b{animation:bt-dash 1.1s cubic-bezier(.4,0,.2,1) infinite}
/* Waiting for teammates to hand back work circles like coordinating them. */
.bt-mark:is([data-state=orbit],[data-state=waiting]) .bt-b{animation:bt-sway 2.6s ease-in-out infinite;transform-origin:50% 50%}
.bt-mark:is([data-state=orbit],[data-state=waiting]) .bt-eyes{animation:bt-roll 2.6s linear infinite}
/* A question for you hops twice when it arrives and the badge keeps it in view after;
   a lively mark keeps hopping. */
.bt-mark[data-state=alert] .bt-b{animation:bt-hop 1.3s cubic-bezier(.3,.7,.4,1) 2}
.bt-mark[data-shape=image]:not([data-state=idle]) .bt-mark-img{animation:bt-bob 1.6s ease-in-out infinite}
.bt-mark[data-shape=image][data-state=alert] .bt-mark-img{animation:bt-hop 1.3s cubic-bezier(.3,.7,.4,1) 2}
body[data-bt-motion=lively] .bt-mark[data-state=alert] :is(.bt-b,.bt-mark-img){animation-iteration-count:infinite}
.bt-mark[data-state=done] .bt-b{animation:bt-done 1.8s linear 1}
.bt-mark[data-shape=image][data-state=done] .bt-mark-img{animation:bt-done 1.8s linear 1;transform-origin:50% 100%}
@keyframes bt-done{0%{transform:none;animation-timing-function:cubic-bezier(.4,0,.2,1)}13.3%{transform:scale(1.12,.88);animation-timing-function:cubic-bezier(.4,0,.2,1)}25.6%{transform:scale(.93,1.09);animation-timing-function:cubic-bezier(.4,0,.2,1)}37.8%{transform:scale(1.04,.97);animation-timing-function:cubic-bezier(.4,0,.2,1)}51.1%,100%{transform:none}}
.bt-mark-poke .bt-b{animation:bt-poke .8s cubic-bezier(.3,.7,.4,1) 1!important;transform-origin:50% 60%!important}
.bt-mark-poke .bt-mark-img{animation:bt-poke-img .6s ease-out 1!important}
.bt-mark[data-poke]{cursor:pointer}
body[data-bt-motion=quiet] .bt-mark-poke :is(.bt-b,.bt-mark-img){animation:none!important}
body[data-bt-motion=quiet] .bt-mark[data-poke]{cursor:default}
@keyframes bt-bob{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-4%) rotate(-5deg)}65%{transform:translateY(0) rotate(4deg)}}
@keyframes bt-wiggle{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-12deg) scale(1.04)}75%{transform:rotate(12deg) scale(1.04)}}
@keyframes bt-squash{0%,100%{transform:scale(1,1)}30%{transform:scale(1.08,.9)}55%{transform:translateY(-4%) scale(.94,1.08)}80%{transform:scale(1.02,.98)}}
@keyframes bt-ponder{0%,100%{transform:translateY(0) rotate(4deg)}50%{transform:translateY(-3%) rotate(7deg)}}
@keyframes bt-squint{0%,100%{transform:translate(0,-4%) scaleY(.7)}50%{transform:translate(5%,-5%) scaleY(.78)}}
@keyframes bt-seek{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-5%) rotate(-1deg)}}
@keyframes bt-scan{0%,100%{transform:translateX(-12%)}50%{transform:translateX(12%)}}
@keyframes bt-dash{0%,100%{transform:translateX(0) rotate(0)}35%{transform:translateX(9%) rotate(7deg)}55%{transform:translateX(-2%) rotate(-3deg)}}
@keyframes bt-sway{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
@keyframes bt-roll{0%,100%{transform:translate(12%,0)}25%{transform:translate(0,9%)}50%{transform:translate(-12%,0)}75%{transform:translate(0,-9%)}}
@keyframes bt-hop{0%,55%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(-14%) scale(.96,1.05)}40%{transform:translateY(0) scale(1.06,.94)}}
@keyframes bt-poke{0%{transform:none}55%{transform:translateY(-16%) rotate(360deg)}78%{transform:translateY(0) scale(1.08,.92) rotate(360deg)}100%{transform:rotate(360deg)}}
@keyframes bt-poke-img{0%,100%{transform:scale(1)}40%{transform:scale(1.14) rotate(-6deg)}}
/* Idle clip: two .26s blinks (lid to 3%, then a 6% overshoot) at 1.48s and 3.46s. */
@keyframes bt-blink-idle{0%,29.6%,35%,69.2%,74.6%,100%{transform:scaleY(1)}32.2%,71.8%{transform:scaleY(.03)}33.8%,73.4%{transform:scaleY(1.06)}}
@keyframes bt-blink{0%,42%,50%,100%{transform:scaleY(1)}46%{transform:scaleY(.03)}48%{transform:scaleY(1.06)}}
@media (prefers-reduced-motion:reduce){.bt-mark *{animation:none!important;transition:none!important}}
.bt-badge{position:absolute;right:0;bottom:0;width:12px;height:12px;border-radius:50%;corner-shape:round;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.bt-badge-admin{background:color-mix(in srgb,var(--bt-star) 82%,var(--bt-sidebar))}
.bt-badge-admin svg{width:7px;height:7px}
.bt-badge-main{right:calc(var(--bt-size,36px) * -.07);bottom:calc(var(--bt-size,36px) * -.07);width:clamp(14px,calc(var(--bt-size,36px) * .36),22px);height:clamp(14px,calc(var(--bt-size,36px) * .36),22px);border-radius:0;box-shadow:none}
.bt-badge-main svg{width:100%;height:100%;overflow:visible}
.bt-badge-main path{fill:var(--bt-star);stroke:var(--bt-sidebar);stroke-width:2.6;stroke-linejoin:round;paint-order:stroke}
.bt-badge-alert{background:color-mix(in srgb,var(--bt-accent) 78%,var(--bt-sidebar));color:var(--bt-accent-ink,#fff);font-size:8.5px;line-height:12px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-badge-working{background:color-mix(in srgb,var(--bt-green) 82%,var(--bt-sidebar));width:8px;height:8px;right:1px;bottom:1px}
.bt-cluster{position:relative;display:inline-block;flex:none;line-height:0}
.bt-cluster>*{position:absolute}
.bt-cluster-more,.bt-cluster-you{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bt-active);color:var(--bt-ink-3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-weight:500;line-height:1;font-variant-numeric:tabular-nums}
.bt-cluster-you{background:color-mix(in srgb,var(--bt-ink) 12%,transparent)}
.bt-stack{display:inline-flex;align-items:center;flex:none;line-height:0}
.bt-stack>*+*{margin-left:calc(var(--bt-stack-size) * -.3)}
.bt-stack-more{font-size:11px;line-height:16px;color:var(--bt-ink-3);margin-left:3px!important}
`
