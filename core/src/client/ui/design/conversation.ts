// The transcript: chat bubbles and their rows, the hover toolbar and reactions, the
// question cards the Bot asks, and the cells that report a turn's progress (thinking,
// events, the activity row).
import { DEFAULT_MASK } from '../../characters.ts'
import { EASE_OUT, MOTION_PRESETS, spring, SPRING_POP, SPRING_SHAPE, SPRING_TAP } from '../../motion.tsx'
import { MENTION_ORIGIN } from '../../text.ts'

// Assistant bubbles, group rows and the question card.
export const CONVERSATION_CARDS_CSS = `

.bt-astack{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin:0}
.bt-bubble{max-width:min(80%,560px,calc(100% - 82px));background:var(--bt-bubble);color:var(--bt-ink);border-radius:18px;padding:7px 12px;font-size:var(--dsh-content-font-size,14px);line-height:calc(var(--dsh-content-font-size,14px) + 8px);box-sizing:border-box;overflow-wrap:anywhere}
.bt-msg:not(:first-child)>.bt-msg-line>.bt-bubble{border-start-start-radius:6px}
.bt-msg:not(:last-child)>.bt-msg-line>.bt-bubble{border-end-start-radius:6px}
.bt-bubble [class*="_markdown"]>*+*{margin-top:10px}
.bt-bubble [class*="_markdown"]{color:inherit!important;font-size:inherit!important;line-height:inherit!important}
.bt-bubble p{margin:0}
.bt-bubble p + p{margin-top:6px}
.bt-bubble ul,.bt-bubble ol{margin:4px 0;padding-left:20px}
.bt-bubble a[href^="${MENTION_ORIGIN}"]{text-decoration:none;font-weight:400;cursor:pointer;white-space:nowrap}
.bt-bubble a[href^="${MENTION_ORIGIN}"]::before{content:"";display:inline-block;width:16px;height:16px;margin-right:3px;vertical-align:-3px;background:currentColor;-webkit-mask:${DEFAULT_MASK} center/contain no-repeat;mask:${DEFAULT_MASK} center/contain no-repeat}
.bt-group-msg{display:flex;flex-direction:column;gap:4px;margin:16px 0 0}
.bt-group-msg:first-child{margin-top:0}
.bt-lead{flex:none;display:flex;margin-bottom:1px}
button.bt-lead{border:0;background:none;padding:0;cursor:pointer}
/* Rows without the avatar start where the bubble beside it starts: 22px avatar + 8px gap. */
.bt-astack[data-lead]>.bt-msg:not(:last-child)>.bt-msg-line,.bt-astack[data-lead] .bt-reacts{margin-left:30px}
.bt-group-name{font-size:12px;line-height:16px;font-weight:500;margin-left:42px}
.bt-group-time,.bt-group-took{margin-left:6px;font-size:11px;line-height:16px;font-weight:400;color:var(--bt-ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-x{border:0;background:none;color:var(--bt-ink-2);cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:16px;line-height:24px;padding:0;transition:background-color .12s ease,color .12s ease,${spring(SPRING_TAP, 'scale')}}
.bt-x:hover{background:var(--bt-hover);color:var(--bt-ink)}

.bt-q{margin:0 auto 8px;width:100%;max-width:var(--dsh-chat-content-width,748px);display:flex;flex-direction:column;gap:12px;--bt-q-edge:color-mix(in srgb,var(--bt-ink) 10%,transparent);--bt-q-rule:color-mix(in srgb,var(--bt-ink) 8%,transparent);--bt-q-rule-2:color-mix(in srgb,var(--bt-ink) 5%,transparent);background:var(--bt-card);box-shadow:0 1px 3px rgba(20,20,20,.04),inset 0 0 0 1px var(--bt-q-edge);border-radius:16px;padding:14px 16px;box-sizing:border-box;color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} backwards,bt-veil-in .2s ease-out backwards}
body[data-ds-dark-theme] .bt-q{--bt-q-edge:rgba(255,255,255,.16);--bt-q-rule:rgba(255,255,255,.12);--bt-q-rule-2:rgba(255,255,255,.08)}
@keyframes bt-q-in{from{transform:translateY(10px) scale(.97)}}
.bt-q-settled{animation:none}
.bt-q-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.bt-q-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.bt-q-title{margin:0;font-size:15px;line-height:22px;font-weight:600;overflow-wrap:anywhere}
.bt-q-detail{font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-q-x{flex:none;width:20px;height:20px;border:0;padding:0;border-radius:6px;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease,color .12s ease,${spring(SPRING_TAP, 'scale')}}
.bt-q-x svg{width:14px;height:14px}
.bt-q-x:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-q-x:focus-visible,.bt-q-opt:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-q-list{display:flex;flex-direction:column;gap:1px;min-width:0;box-sizing:border-box;margin:0 -8px}
.bt-q-opt{position:relative;display:flex;align-items:flex-start;gap:16px;width:100%;min-width:0;box-sizing:border-box;margin:0;border:0;border-radius:12px;background:transparent;padding:10px 8px;font:inherit;color:var(--bt-ink);text-align:start;cursor:pointer;transition:background-color .12s ease}
.bt-q:not(.bt-q-raised)>.bt-q-head:has(+.bt-q-list){padding-bottom:12px;border-bottom:1px solid var(--bt-q-rule)}
.bt-q:not(.bt-q-raised)>.bt-q-head+.bt-q-list{margin-top:-6px}
.bt-q-opt+.bt-q-opt::before{content:"";position:absolute;left:calc(var(--bt-key,24px) + 24px);right:8px;top:-1px;height:1px;background:var(--bt-q-rule-2);transition:opacity .12s ease;pointer-events:none}
button.bt-q-opt:hover::before,button.bt-q-opt:hover+.bt-q-opt::before,.bt-q-opt[aria-pressed=true]::before,.bt-q-opt[aria-pressed=true]+.bt-q-opt::before{opacity:0}
.bt-q-raised .bt-q-opt::before{display:none}
button.bt-q-opt:hover{background:var(--bt-hover)}
button.bt-q-opt:active{background:var(--bt-active)}
.bt-q-opt[aria-pressed=true]{background:var(--bt-active)}
.bt-q:not(.bt-q-raised) :is(button.bt-q-opt:hover,.bt-q-opt[aria-pressed=true]) .bt-key{background:var(--bt-card);color:var(--bt-ink)}
.bt-key{flex:none;box-sizing:border-box;width:var(--bt-key,24px);height:var(--bt-key,24px);border-radius:8px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:12px;line-height:var(--bt-key,24px);font-weight:500;text-align:center;font-variant-numeric:tabular-nums;transition:background-color .12s ease,color .12s ease}
.bt-q-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:2px}
/* With a description the key spans the two text lines less 2px above and below. */
.bt-q-opt:has(.bt-q-desc){--bt-key:34px}
.bt-q-opt:has(.bt-q-desc) .bt-key{margin-top:2px;border-radius:10px;font-size:13px}
.bt-q-opt:has(.bt-q-desc) .bt-q-body{padding-top:0}
.bt-q-label{font-size:14px;line-height:20px;font-weight:500;white-space:normal;overflow-wrap:anywhere}
.bt-q-desc{font-size:12px;line-height:17px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-q-check{flex:none;display:inline-flex;align-items:center;color:var(--bt-ink-2);animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} backwards}
.bt-q-settled .bt-q-check{animation:none}
.bt-q-check svg{width:16px;height:16px}
.bt-q-settled .bt-key{opacity:.4}
.bt-q-settled .bt-q-label{color:color-mix(in srgb,var(--bt-ink) 45%,transparent)}
.bt-q-dismissed .bt-q-title{color:var(--bt-ink-2)}
.bt-q.bt-q-settled{gap:6px;padding:12px 16px}
.bt-q-settled .bt-q-title{font-size:14px;line-height:20px;font-weight:500}
.bt-q.bt-q-settled>.bt-q-head:has(+.bt-q-list){padding-bottom:0;border-bottom:0}
.bt-q.bt-q-settled>.bt-q-head+.bt-q-list{margin-top:0}
.bt-q-settled .bt-q-opt{padding:4px 8px}
.bt-q-badge{flex:none;height:20px;padding:0 7px;border-radius:999px;border:1px dotted var(--bt-line-2);color:var(--bt-ink-2);font-size:12px;line-height:18px;box-sizing:border-box}
.bt-q-custom{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0}
.bt-q-field{flex:1 1 0;min-width:0;display:flex;box-sizing:border-box;min-height:32px;padding:5px 11px;border-radius:8px;border:.5px solid var(--bt-line-2);background:none;cursor:text;transition:border-color .12s ease}
.bt-q-field:focus-within{border-color:color-mix(in srgb,var(--bt-ink) 30%,transparent)}
.bt-q-input{flex:1;width:100%;min-width:0;max-height:120px;margin:0;padding:0;border:0;outline:none;background:transparent;color:var(--bt-ink);font:inherit;font-size:14px;line-height:20px;resize:none;overflow-y:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
.bt-q-input:not(:placeholder-shown){field-sizing:content}
.bt-q-input::placeholder{color:var(--bt-ink-3)}
.bt-q-submit,.bt-q-btn{flex:none;height:36px;padding:0 14px;border:0;border-radius:999px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;transition:opacity .12s ease,background-color .12s ease,${spring(SPRING_TAP, 'scale')}}
.bt-q-submit{background:var(--bt-accent);color:var(--bt-accent-ink,#fff);animation:bt-q-submit-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing} backwards,bt-veil-in .16s ease-out backwards}
@keyframes bt-q-submit-in{from{transform:translateX(8px) scale(.9)}}
.bt-q-submit:hover:not(:disabled){opacity:.86}
.bt-q-submit:disabled{opacity:.4;cursor:default}
.bt-q-btn{background:var(--bt-hover);color:var(--bt-ink)}
.bt-q-btn:hover{background:var(--bt-active)}
.bt-q-foot{display:flex;justify-content:flex-end;gap:8px}
.bt-q-raised{width:calc(var(--dsh-chat-content-width,748px) - 32px);max-width:calc(100% - 32px);gap:0;padding:0;box-shadow:0 2px 8px rgba(20,20,20,.035),inset 0 0 0 .5px color-mix(in srgb,var(--bt-ink) 5%,transparent)}
.bt-q-raised .bt-q-head{padding:14px 16px 4px 20px}
.bt-q-raised .bt-q-head:last-child{padding-bottom:16px}
.bt-q-raised .bt-q-list{gap:1px;margin:0;padding:8px}
.bt-q-raised .bt-q-opt{gap:4px;padding:7px;border-radius:16px;color:var(--bt-ink-2)}
.bt-q-raised button.bt-q-opt:hover{color:var(--bt-ink)}
.bt-q-raised .bt-q-opt[aria-pressed=true]{background:transparent;color:var(--bt-ink)}
.bt-q-raised .bt-q-opt[aria-pressed=true]:hover{background:var(--bt-hover)}
.bt-q-raised .bt-q-opt[aria-pressed=true] .bt-key,.bt-q-ownrow:focus-within .bt-key,.bt-q-ownrow[data-filled] .bt-key{background:var(--bt-user);color:var(--bt-user-ink)}
.bt-q-raised .bt-q-body{padding:2px 6px 0}
.bt-q-raised .bt-q-desc{color:color-mix(in srgb,var(--bt-ink) 61%,transparent)}
.bt-q-ownrow{cursor:text}
.bt-q-ownrow .bt-q-input{color:var(--bt-ink)}
.bt-q-raised .bt-q-foot{padding:0 8px 8px}
@media (prefers-reduced-motion:reduce){.bt-q{animation:bt-fade .12s ease-out backwards}.bt-q-settled{animation:none}.bt-q-submit{animation:none}}`

// The message row, its hover toolbar, reactions, and the user avatar seat.
export const MESSAGE_ACTIONS_CSS = `
.bt-msg{display:flex;flex-direction:column;align-items:flex-start;max-width:min(80%,560px,calc(100% - 82px))}
/* The bubble's row: reactions hang below it, so the hover toolbar (and a group
   sender's avatar) line up with the bubble alone. */
.bt-msg-line{position:relative;display:flex;align-items:flex-end;gap:8px;max-width:100%}
.bt-msg-line>.bt-bubble{max-width:none;min-width:0}
/* The same bubble width as beside an avatar column: 80% of (100% - 30px), plus the 30px. */
.bt-astack[data-lead]>.bt-msg{max-width:min(calc(80% + 6px),590px,calc(100% - 52px))}
.bt-tools{position:absolute;top:50%;left:100%;margin-left:6px;transform:translateY(-50%);display:flex;gap:2px;opacity:0;visibility:hidden;transition:opacity .12s ease,visibility .12s}
.bt-tools::after{content:"";position:absolute;top:-8px;bottom:-8px;right:100%;width:128px;z-index:-1}
.bt-msg:hover>.bt-msg-line>.bt-tools,.bt-msg:focus-within>.bt-msg-line>.bt-tools,.bt-tools[data-open]{opacity:1;visibility:visible}
.bt-tool{width:24px;height:24px;border:0;padding:0;border-radius:6px;background:none;color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.bt-tool:hover,.bt-tool[aria-expanded=true]{background:var(--bt-hover);color:var(--bt-ink)}
.bt-tool:active{background:var(--bt-active)}
.bt-tool:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-react-strip{position:fixed;z-index:60;pointer-events:auto;display:flex;gap:2px;padding:4px;border-radius:999px;background:var(--bt-main);border:.5px solid var(--bt-line-2);box-shadow:0 10px 20px -3px rgba(0,0,0,.08),0 4px 6px -4px rgba(0,0,0,.06);transform:translate(-50%,-100%);transform-origin:bottom center;animation:bt-pop-lift ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .14s ease-out}
.bt-react-strip button{width:32px;height:32px;border:0;border-radius:50%;background:none;font-size:18px;line-height:1;cursor:pointer;transition:background-color .12s ease,${spring(SPRING_POP, 'transform')};animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} backwards}
.bt-react-strip button:nth-child(2){animation-delay:20ms}
.bt-react-strip button:nth-child(3){animation-delay:40ms}
.bt-react-strip button:nth-child(4){animation-delay:60ms}
.bt-react-strip button:nth-child(n+5){animation-delay:80ms}
.bt-react-strip button:hover{background:var(--bt-hover);transform:scale(1.15)}
.bt-react-strip button:active{transform:scale(.92)}
.bt-reacts{display:flex;gap:4px;margin-top:4px}
.bt-react{height:22px;min-width:30px;padding:0 6px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);font-size:13px;line-height:20px;cursor:pointer;animation:bt-react-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing};transition:background-color .12s ease,${spring(SPRING_TAP, 'scale')}}
.bt-react:hover{background:var(--bt-hover)}
.bt-react:active{scale:.92}
@keyframes bt-react-pop{from{transform:scale(.6);opacity:0}}
.bt-bubble a[href^="${MENTION_ORIGIN}"] svg{display:none}
.bt-you{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bt-ink) 5%,var(--bt-sidebar));color:var(--bt-ink-2);box-shadow:inset 0 0 0 1px var(--bt-line);transition:background-color .12s ease}
button:hover .bt-you{background:color-mix(in srgb,var(--bt-ink) 9%,var(--bt-sidebar))}
.bt-you-wrap{display:inline-flex;padding:0}
.bt-connect-foot{width:100%;height:36px}
`

// Thinking and events, the activity row, shimmer, and row entry.
export const CONVERSATION_CELLS_CSS = `
.bt-think{font-size:13px;line-height:18px;color:var(--bt-ink-2);margin:2px 0 4px;max-width:min(560px,78%)}
.bt-think summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px}
.bt-think summary::-webkit-details-marker{display:none}
.bt-think-time{font-variant-numeric:tabular-nums;white-space:nowrap}
/* Five lines of the 18px line height; the rest scrolls inside the box. */
.bt-think-text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px;padding-left:10px;border-left:2px solid var(--bt-line-2);max-height:90px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;outline:none}
.bt-think-text:focus-visible{border-left-color:var(--bt-ink-2)}
.bt-think-text[data-fade=top]{mask-image:linear-gradient(to bottom,transparent,#000 18px)}
.bt-think-text[data-fade=bottom]{mask-image:linear-gradient(to top,transparent,#000 18px)}
.bt-think-text[data-fade=both]{mask-image:linear-gradient(to bottom,transparent,#000 18px,#000 calc(100% - 18px),transparent)}
.bt-event{display:flex;justify-content:center;align-items:center;gap:2px;min-height:24px;margin:2px 0;font-size:12px;line-height:16px;color:var(--bt-ink-2);flex-wrap:wrap}
.bt-event>span{padding:0 2px}
.bt-event button{border:0;background:none;color:inherit;font:inherit;display:inline-flex;align-items:center;gap:4px;cursor:pointer;height:24px;padding:4px 6px 4px 4px;border-radius:999px;box-sizing:border-box;transition:background-color .12s ease}
.bt-event button:hover{background:var(--bt-hover)}
.bt-event button:active{background:var(--bt-active)}
:is(.bt-event button,button.bt-lead,.bt-think summary):focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-event button.bt-event-whole{min-width:0;max-width:100%;padding:4px 6px 4px 8px}
.bt-event-whole>*{flex:none}
.bt-event-whole>span:first-child{margin-right:2px}
/* One button cannot wrap like separate parts, so a long name is cut to fit the chat. */
.bt-event-whole>.bt-event-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-time-sep{display:flex;justify-content:center;align-items:center;height:28px;margin:14px 0 8px;font-size:12px;line-height:16px;color:var(--bt-ink-2);white-space:nowrap}
[class*="_scroll"]>[class*="_column"]::before{content:var(--bt-first-sep,none);display:block;flex:none;height:28px;margin:17px 0 12px;font-size:12px;line-height:28px;text-align:center;color:var(--bt-ink-2);white-space:nowrap}
.bt-activity{display:flex;align-items:center;gap:10px;margin:8px 0 4px 2px;font-size:14px;color:var(--bt-ink-2)}
.bt-group-replies{display:contents}
/* A Bot chat is flat in every work-details mode, without changing the user's mode
   (it is a DSH-wide setting): step groups lose their header and stay open, and what a
   mode folds away in a finished turn stays shown. TurnProcessCell also opens that
   fold; these rules cover the first frame before it does. */
[data-step-process]>div:first-child{display:none!important}
[data-step-process]>[data-step-process-body]{display:block!important;content-visibility:visible!important;max-height:none!important;overflow:visible!important;mask-image:none!important;scrollbar-gutter:auto!important}
:is([data-step-process],[data-turn-process-hidden])[hidden]{content-visibility:visible!important}
[class*="_flowItem"]:has(> [data-slot="conversation.chat.node"]:empty){display:none!important}
[class*="_header"]:has(.bt-head){border-bottom-color:transparent!important;box-shadow:none!important}
/* The transcript runs under a floating header pill. */
header[class*="_header"]:has(.bt-head){position:absolute!important;top:0;left:0;right:0;z-index:8;display:flex!important;padding:10px 0 0!important;background:transparent!important;pointer-events:none;justify-content:center}
header[class*="_header"]:has(.bt-head)::before{content:"";position:absolute;inset:0 0 auto;height:52px;background:color-mix(in srgb,var(--bt-main) 82%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(14px);backdrop-filter:saturate(1.4) blur(14px);box-shadow:0 .5px 0 var(--bt-line);pointer-events:none;z-index:-1}
header[class*="_header"]:has(.bt-head)::after{content:"";position:absolute;inset:52px 0 auto;height:18px;background:linear-gradient(to bottom,color-mix(in srgb,var(--bt-main) 70%,transparent),transparent);pointer-events:none;z-index:-1}
header[class*="_header"]:has(.bt-head)>[class*="_headerLeading"]{position:absolute;left:12px;top:10px;pointer-events:auto}
header[class*="_header"] .bt-head{flex:1 1 auto;width:100%}
[class*="_body"]:has(> [class*="_scrollBody"]){--dsh-chat-content-width:min(960px,100%)}
/* The shell writes the column's width on the conversation root at every resize, only to
   derive the content width that the rule above replaces. Inherited, each write restyled
   the whole conversation: once a frame while the details panel glides, most in a long
   group chat. Kept on the root alone, a write restyles one element. */
@property --dsh-conversation-column-width{syntax:"*";inherits:false}
@property --dsh-chat-user-width{syntax:"*";inherits:false}
/* DSH's turn tail keeps what plugins put in it (delivered files, the Bot's separators),
   without its copy and branch row; a tail with nothing in it takes no room. */
[data-turn-tail]>:not([data-slot="conversation.chat.turnTail"]){display:none!important}
[class*="_flowItem"][data-chat-flow-kind="turn-tail"]:not(:has([data-slot="conversation.chat.turnTail"]:not(:empty))){display:none!important}
/* Every team Session belongs to a Bot or a group, so a blank one is an empty chat, not
   the shell's new-session hero: no headline, no workspace or mode picker, and the
   composer stays docked at the bottom. */
[data-content-phase=hero] [class*="_scrollBody"]{justify-content:flex-end!important}
[data-content-phase=hero] [class*="_composerHero"]{align-self:stretch!important;width:auto!important;padding-bottom:0!important}
[data-content-phase=hero] [class*="_composerHero"]>[class$="_root"],[data-content-phase=hero] [class*="_heroWorkspaceRow"]{display:none!important}
[data-content-phase=hero] [class*="_composerHero"] [class*="_input"]{min-height:0!important}
/* The right sides give back the scrollbar gutter so both edges sit 16px from the column. */
[class*="_scroll"]:has(> [class*="_column"]){padding:60px 11px 16px 16px!important}
/* The shell's running status only hosts the activity row (.bt-typing). */
[data-chat-running]{display:block!important;width:100%;min-height:0!important;margin:0!important;padding:0!important}
[data-chat-running]>span:not([role=status]){display:none!important}
[data-chat-running]:has(> .bt-typing){margin-top:var(--dsh-chat-flow-gap,12px)!important}
.bt-typing{display:flex;align-items:center;gap:12px;height:36px;min-width:0;padding-inline-start:8px;transform-origin:0 50%;animation:bt-typing-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing} backwards}
.bt-typing[data-exiting]{animation:bt-typing-out .14s cubic-bezier(.22,1,.36,1) forwards}
.bt-typing>.bt-mark,.bt-typing>.bt-cluster{flex-shrink:0}
.bt-typing>.bt-mark{cursor:pointer;transition:filter .16s ease-out}
.bt-typing>.bt-mark:hover{filter:drop-shadow(0 2px 4px rgba(0,0,0,.18))}
.bt-typing>.bt-mark .bt-eyes{transition:scale .28s cubic-bezier(.4,.06,.18,1)}
.bt-typing>.bt-mark:hover .bt-eyes{scale:1.18}
.bt-typing-text{display:flex;align-items:center;flex:1 1 auto;min-width:0;animation:bt-typing-label .22s ease-out .2s backwards}
.bt-typing-label{display:inline-flex;align-items:center;gap:6px;min-width:0;animation:bt-typing-label .22s ease-out backwards}
.bt-typing-label>.bt-shimmer{font-size:14px;line-height:22px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-typing-time{flex-shrink:0;margin-left:6px;font-size:12px;line-height:22px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
@keyframes bt-typing-in{from{opacity:0;transform:scale(.9)}}
@keyframes bt-typing-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.92);filter:blur(3px)}}
@keyframes bt-typing-label{from{opacity:0;filter:blur(5px);transform:translateY(3px)}}
/* Shimmer: a stepped sweep clipped to the text. */
.bt-shimmer{color:transparent;background:linear-gradient(90deg,var(--bt-shimmer-base) 0%,var(--bt-shimmer-base) 25%,var(--bt-ink) 60%,var(--bt-shimmer-base) 75%,var(--bt-shimmer-base) 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;animation:bt-shimmer 2.2s steps(60) infinite;--bt-shimmer-base:color-mix(in srgb,var(--bt-ink) 40%,transparent)}
/* Thinking dots (after open-claude-ui's StatusIndicators, MIT). */
.bt-dots{display:inline-flex;gap:3px;margin-left:-2px}
.bt-dots i{width:4px;height:4px;border-radius:50%;background:var(--bt-ink-3);animation:bt-dot 1.2s ease-in-out infinite}
.bt-dots i:nth-child(2){animation-delay:.15s}
.bt-dots i:nth-child(3){animation-delay:.3s}
@keyframes bt-dot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
@keyframes bt-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
/* New rows slide up; a reply that replaces the activity row grows out of its corner. */
[data-bt-enter="new"]{animation:bt-row-in ${MOTION_PRESETS.message.enter.duration}ms ${MOTION_PRESETS.message.enter.easing}}
[data-bt-enter="after-collapse"]{transform-origin:0 100%;animation:bt-row-after ${MOTION_PRESETS.message.collapseMs}ms ${EASE_OUT} .38s backwards}
@keyframes bt-row-in{from{transform:translateY(12px)}to{transform:none}}
@keyframes bt-row-after{0%{opacity:0;transform:translateY(12px) scale(.94)}55%{opacity:1}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
.bt-typing,.bt-typing[data-exiting]{animation-name:bt-fade-in;animation-duration:.12s;transform:none}
.bt-typing[data-exiting]{animation-name:bt-fade-out}
.bt-typing-text,.bt-typing-label{animation-name:bt-fade-in;animation-delay:0s}
.bt-shimmer{animation:none;background:none;color:var(--bt-ink-2)}
.bt-dots i{animation:none}
[data-bt-enter="new"]{animation:none}
[data-bt-enter="after-collapse"]{animation:bt-fade-in .12s ease-out}
}
@keyframes bt-fade-in{from{opacity:0}to{opacity:1}}
@keyframes bt-fade-out{from{opacity:1}to{opacity:0}}`
