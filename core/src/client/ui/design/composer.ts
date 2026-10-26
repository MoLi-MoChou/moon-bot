// The conversation's input surfaces: the new-chat card, the docked composer and the
// plugin controls seated in it, and the user-side bubbles and jump-to-latest controls
// that sit around it.
import { spring, SPRING_POP, SPRING_SHAPE, SPRING_TAP } from '../../motion.tsx'

// The new-chat surface: recipient field, Bot picker and create card.
export const NEW_CHAT_CSS = `

.bt-newchat{flex:1;display:flex;flex-direction:column;min-width:0;position:relative;animation:bt-veil-in .18s ease-out}
.bt-to{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--bt-line);font-size:14px;box-sizing:border-box}
.bt-to-label{color:var(--bt-ink-2)}
.bt-to input{flex:1;min-width:120px;border:0;outline:none;background:none;color:var(--bt-ink);font-size:14px;height:26px}
.bt-token{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 6px 0 4px;border-radius:999px;background:var(--bt-hover);font-size:13px;animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-token button{border:0;background:none;color:var(--bt-ink-2);cursor:pointer;padding:0 2px}
.bt-admin-star{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border-radius:50%;corner-shape:round;background:color-mix(in srgb,var(--bt-star) 82%,var(--bt-sidebar));vertical-align:-1px}
.bt-to-star{display:inline-flex;margin-right:-2px;animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-to .bt-to-create{flex:none;height:28px;padding:0 12px;font-size:13px;animation:bt-q-submit-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
.bt-drop{position:absolute;top:48px;left:32px;width:min(550px,calc(100% - 64px));display:flex;flex-direction:column;padding:6px;max-height:min(420px,60vh);overflow-y:auto;background:var(--bt-card);border:1px solid var(--bt-line-2);border-radius:12px;box-shadow:0 6px 20px -4px rgba(0,0,0,.12);box-sizing:border-box;z-index:1;transform-origin:24px 0;animation:bt-pop-drop ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .14s ease-out}
.bt-option{display:flex;align-items:center;gap:10px;border:0;background:none;border-radius:8px;padding:7px 8px;min-height:36px;box-sizing:border-box;font-size:13px;line-height:18px;color:var(--bt-ink);cursor:pointer;text-align:left;width:100%}
.bt-option[aria-selected=true]{background:var(--bt-active)}
.bt-drop-list>.bt-option:not([aria-selected=true]):hover{background:var(--bt-hover)}
.bt-option-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-option-hint{font-size:11px;color:var(--bt-ink-2);flex:none;animation:bt-veil-in .16s ease-out}
.bt-option-icon{width:22px;height:22px;border-radius:50%;background:var(--bt-hover);color:var(--bt-ink-2);display:inline-flex;align-items:center;justify-content:center;flex:none}
.bt-hint{padding:14px;text-align:center;font-size:13px;color:var(--bt-ink-2)}
.bt-nc-spacer{flex:1}
.bt-nc-compose{padding:0 16px 14px;display:flex;justify-content:center}
.bt-nc-card{display:flex;align-items:flex-end;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,748px);min-height:44px;padding:4px 6px;border-radius:22px;border:1px solid var(--bt-line-2);background:var(--bt-main);box-shadow:0 2px 8px -2px rgba(0,0,0,.06);box-sizing:border-box}
.bt-nc-plus{width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--bt-ink-2);background:var(--bt-hover);flex:none}
.bt-nc-card textarea{flex:1;resize:none;border:0;outline:none;background:none;color:var(--bt-ink);font:inherit;font-size:14px;line-height:20px;padding:7px 4px;min-height:34px;max-height:140px;box-sizing:border-box}
.bt-nc-send{width:34px;height:34px;border-radius:50%;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.bt-nc-send:disabled{opacity:.3;cursor:default}
.bt-create{flex:1;display:flex;flex-direction:column;min-width:0}
.bt-create-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--bt-line);box-sizing:border-box}
.bt-create-gap{width:28px}
.bt-create-title{font-size:14px;line-height:20px;font-weight:500}
.bt-create-body{flex:1;overflow-y:auto;padding:28px 16px 32px;display:flex;justify-content:center}
.bt-create-card{width:100%;max-width:400px;display:flex;flex-direction:column;gap:18px;animation:bt-q-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing} both,bt-veil-in .22s ease-out both}
.bt-create-preview{display:flex;flex-direction:column;align-items:center;gap:10px}
.bt-create-pop{display:inline-flex;animation:bt-create-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} both}
@keyframes bt-create-pop{from{transform:scale(.72);opacity:.4}}
.bt-create-name{font-size:17px;line-height:24px;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-create-step{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin-bottom:-10px}
.bt-create-looks{display:flex;flex-direction:column;gap:10px;padding:10px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.bt-create-lookbar{justify-content:center}
.bt-create-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}
.bt-create-go{height:36px;padding:0 20px}
@media (prefers-reduced-motion:reduce){.bt-create-card,.bt-create-pop{animation:none}}
.bt-send{height:40px;min-width:40px;border-radius:999px;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font-size:14px;padding:0 14px;cursor:pointer;flex:none;white-space:nowrap}
.bt-send:disabled{opacity:.35;cursor:default}
.bt-error{padding:0 14px 10px;color:var(--bt-danger);font-size:12px}`

// The composer card, voice controls, user bubbles, and the news/to-bottom controls.
export const CONVERSATION_COMPOSER_CSS = `
[data-composer-card]{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:0!important;min-height:44px!important;border-radius:22px!important;padding:7.5px!important;box-sizing:border-box;background:var(--bt-main)!important;border:.5px solid var(--bt-line-2)!important;box-shadow:0 2px 8px -1px rgba(0,0,0,.05),0 1px 2px rgba(0,0,0,.03),0 0 0 1px rgba(228,228,228,.04)!important;transition:border-color .15s ease,background-color .15s ease,${spring(SPRING_SHAPE, 'border-radius')}!important}
[data-composer-card]:hover,[data-composer-card]:focus-within{border-color:color-mix(in srgb,var(--bt-ink) 30%,transparent)!important}
[data-composer-card]:has(> [data-slot="conversation.input.attachments"] *),[data-composer-card]:has([data-composer-input] br + *),[data-composer-card]:has([data-composer-input] > :nth-child(2)){border-radius:18px!important}
[class*="_root"]:has(> [data-composer-card]){padding:0 11px 13px 16px!important}
[class*="_root"]:has(> [data-composer-card])>[data-composer-card]{max-width:min(992px,100%)!important}
[data-composer-card]>[class*="_row"]{display:contents!important}
[data-composer-card] [class*="_tools"]{order:1!important;flex:none!important;align-self:flex-end!important;margin:0!important}
[data-composer-card]>[data-input-scroll]{order:2!important;flex:1 1 0!important;min-width:0!important;padding:0 8px!important;margin:0!important}
[data-composer-card] [class*="_trailing"]{order:3!important;flex:none!important;align-self:flex-end!important;margin:0!important}
[data-composer-card]>[data-slot="conversation.input.attachments"]{order:0!important;flex-basis:100%!important}
[data-composer-card] [data-composer-input]{min-height:24px!important;padding:2px 0!important}
[data-composer-card] [data-composer-placeholder]{left:0!important;top:2px!important}
[data-composer-placeholder]{font-size:0!important;line-height:0!important}
/* The name sits on ::before so that ::after stays free for other composer skins. */
[data-composer-placeholder]::before{content:var(--bt-placeholder,"Message")!important;display:block!important;font-size:14px!important;line-height:24px!important;color:var(--bt-ink-3)!important}
/* The team's "+" (ComposerPlus) takes the seat of the shell's command-menu button. */
[data-composer-card] button[class*="_add"]{display:none!important}
.bt-plus{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bt-ink) 5%,transparent);box-shadow:inset 0 0 0 .5px var(--bt-line);color:var(--bt-ink-2);cursor:pointer;transition:background-color .15s ease,color .15s ease,${spring(SPRING_TAP, 'scale')}}
.bt-plus:hover,.bt-plus[aria-expanded=true]{background:color-mix(in srgb,var(--bt-ink) 10%,transparent);color:var(--bt-ink)}
.bt-plus:active{scale:.9}
.bt-plus svg{width:14px;height:14px;transition:${spring(SPRING_POP, 'rotate')}}
.bt-plus[aria-expanded=true] svg{rotate:45deg}
.bt-plus-menu{min-width:180px}
[data-composer-card] [class*="_tools"]{gap:0!important}
[data-composer-card] [class*="_modes"]:empty{display:none!important}
[data-composer-card] [class*="_activity"]:not(:has([data-slot] > *)){display:none!important}
[data-composer-card] [class*="_trailing"]{gap:8px!important}
/* No display here: DSH hides these controls with [hidden] while the Bot works. */
[data-composer-card] [class*="_standardControls"]{align-items:center!important;gap:8px!important}
[data-composer-card] button[class*="_primary"]{width:28px!important;height:28px!important;background:var(--bt-accent)!important;color:var(--bt-accent-ink,#fff)!important;border-radius:50%!important;transition:opacity .15s ease,${spring(SPRING_TAP, 'scale')};animation:bt-icon-swap ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
[data-composer-card] button[class*="_primary"]:hover:not(:disabled){opacity:.9}
[data-composer-card] button[class*="_primary"]:active:not(:disabled){scale:.9}
@keyframes bt-icon-swap{from{opacity:0;transform:scale(.5) rotate(-30deg)}}
[data-composer-card] button[class*="_primary"] svg{width:14px;height:14px}
[data-composer-card] button[class*="_primary"]:disabled{display:none!important}
[data-composer-dock]{display:none!important}
.bt-mic,.bt-voice{flex:none;width:28px;height:28px;border-radius:50%;border:0;padding:0;display:inline-grid;place-items:center;cursor:pointer;transition:background-color .15s ease,color .15s ease,${spring(SPRING_TAP, 'scale')}}
.bt-mic{background:color-mix(in srgb,var(--bt-ink) 5%,transparent);box-shadow:inset 0 0 0 .5px var(--bt-line);color:var(--bt-ink-2)}
.bt-mic:hover{background:color-mix(in srgb,var(--bt-ink) 10%,transparent);color:var(--bt-ink)}
.bt-mic[aria-pressed=true]{background:#ff3e51;color:#fff;animation:bt-mic-pulse 1.4s ease-in-out infinite}
@keyframes bt-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,62,81,.35)}50%{box-shadow:0 0 0 5px rgba(255,62,81,0)}}
.bt-voice{display:none;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);animation:bt-icon-swap ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
.bt-voice:hover{opacity:.9}
.bt-mic:active,.bt-voice:active{scale:.9}
[data-composer-card]:has(button[class*="_primary"]:disabled) .bt-voice{display:inline-grid}
body[data-bt-room] .bt-voice{display:none!important}
body[data-bt-room] [data-composer-card]:has(button[class*="_primary"]:disabled) .bt-mic:not([aria-pressed=true]){background:var(--bt-accent);color:var(--bt-accent-ink,#fff)}
.bt-mic-note{position:absolute;right:12px;bottom:calc(100% + 8px);padding:5px 10px;border-radius:8px;background:var(--bt-user);color:var(--bt-user-ink);font-size:12px;line-height:16px;white-space:nowrap;pointer-events:none;animation:bt-rise .16s ease-out}
[data-chain-overlay-fallback="conversation.composer"]:has(~ .bt-q){display:block!important;order:2}
.bt-q{order:1}
div:has(> nav [class*="_marks"]){display:none!important}
/* Every user-side bubble (sent, steering mid-turn, not yet admitted, question replies)
   takes its surface and its text from the one --bt-user pair: a skin that repaints
   the host's bubble surface alone would otherwise leave the text unreadable. */
[class*="_userRow"] [class*="_bubble"],[data-chat-flow-kind=question-reply] [class*="_bubble"],[data-chat-flow-kind=command-input] [class*="_bubble"]{background:var(--bt-user)!important;color:var(--bt-user-ink)!important;border-radius:18px!important;padding:7px 12px!important;font-size:var(--dsh-content-font-size,14px)!important;line-height:calc(var(--dsh-content-font-size,14px) + 8px)!important}
[class*="_userRow"] [class*="_bubble"] [class*="_markdown"],[class*="_userRow"] [class*="_bubble"] a{color:inherit}
/* Sent messages get the hover toolbar below; steering and unsent bubbles keep none. */
[class*="_userRow"] [class*="_actions"]{display:none!important}
[data-chat-flow-kind=user] [class*="_userRow"]{flex-direction:row-reverse;align-items:center;justify-content:flex-start}
[data-chat-flow-kind=user] [class*="_actions"]{display:flex!important;height:24px!important;gap:2px!important;opacity:0!important;visibility:hidden;transition:opacity .12s ease,visibility .12s!important;flex:none}
[data-chat-flow-kind=user] [class*="_userRow"]:hover [class*="_actions"],[data-chat-flow-kind=user] [class*="_userRow"]:focus-within [class*="_actions"]{opacity:1!important;visibility:visible}
[data-chat-flow-kind=user] [class*="_actions"] [class*="_timeStart"]{display:none}
[data-chat-flow-kind=user] [class*="_actions"] button{width:24px;height:24px;border-radius:6px;color:var(--bt-ink-2)}
[data-chat-flow-kind=user] [class*="_actions"] button:hover{background:var(--bt-hover);color:var(--bt-ink)}
[data-chat-flow-kind=user] [class*="_actions"] svg{width:15px;height:15px}
.bt-q-inline{display:flex;margin:4px 0 6px}
[data-chat-flow-kind=assistant-step]+[data-step-process]:has(.bt-q-inline){margin-top:0!important}
[data-chat-flow-kind=question-reply]:has(.bt-q-inline),[data-chat-group-key]:has([data-chat-flow-kind=question-reply] .bt-q-inline),[data-chat-group-key]:has(.bt-q-gone){margin-top:0!important}
.bt-q-inline .bt-q{margin:0;max-width:min(550px,86%);order:0}
.bt-q-dock{width:100%;display:flex;justify-content:center}
.bt-q-dock .bt-q{margin:0 auto 8px}
[class*="_toBottomSlot"]{justify-content:center!important;padding-right:0!important}
[data-conversation-scroll] [class*="_toBottomSlot"]{bottom:calc(var(--dsh-composer-height,152px) + 8px)!important}
[class*="_toBottomSlot"]>button{width:36px!important;height:36px!important;margin-top:-36px!important;background:var(--bt-main)!important;color:var(--bt-ink)!important;box-shadow:0 0 0 .5px var(--bt-line-2),0 2px 8px -2px rgba(0,0,0,.12)!important;animation:bt-tobottom-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out;transition:background-color .12s ease,${spring(SPRING_TAP, 'scale')}}
[class*="_toBottomSlot"]>button:active{scale:.9}
[class*="_toBottomSlot"]>button:hover{background:color-mix(in srgb,var(--bt-ink) 4%,var(--bt-main))!important}
[class*="_toBottomSlot"]>button svg{display:none}
[class*="_toBottomSlot"]>button::before{content:"";width:20px;height:20px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 4v12M5 11l5 5 5-5'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 4v12M5 11l5 5 5-5'/%3E%3C/svg%3E") center/contain no-repeat}
@keyframes bt-tobottom-in{from{translate:0 8px;scale:.8}}
[data-bt-news] [class*="_toBottomSlot"]>button{visibility:hidden!important;pointer-events:none!important}
.bt-news{position:fixed;z-index:30;transform:translateX(-50%);display:inline-flex;align-items:center;overflow:hidden;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);box-shadow:inset 0 0 0 1px rgba(20,20,20,.05),0 1px 3px 0 rgba(0,0,0,.12);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:bt-news-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
@keyframes bt-news-in{from{translate:0 8px;scale:.9}}
.bt-news[data-direction=up]{animation-name:bt-news-in-up,bt-veil-in}
@keyframes bt-news-in-up{from{translate:0 -8px;scale:.9}}
.bt-news-jump{display:inline-flex;align-items:center;gap:2px;margin:0;padding:4px 26px 4px 4px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;white-space:nowrap;cursor:pointer;outline:none}
.bt-news-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px}
.bt-news-ico svg{width:16px;height:16px}
.bt-news-x{position:absolute;right:4px;top:50%;z-index:1;transform:translateY(-50%);width:20px;height:20px;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;opacity:.75;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.bt-news-x svg{width:12px;height:12px}
.bt-news-x:hover{opacity:1;background:rgba(20,20,20,.5)}
.bt-to-bottom{position:fixed;z-index:30;transform:translateX(-50%);display:inline-flex;align-items:center;border-radius:999px;background:var(--bt-main);color:var(--bt-ink);box-shadow:0 0 0 .5px var(--bt-line-2),0 4px 12px -2px rgba(0,0,0,.14);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:bt-tobottom-in ${SPRING_TAP.duration}ms ${SPRING_TAP.easing},bt-veil-in .16s ease-out}
.bt-to-bottom-btn{display:inline-flex;align-items:center;gap:4px;height:34px;padding:0 14px 0 10px;border:0;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,${spring(SPRING_TAP, 'scale')}}
.bt-to-bottom-btn:hover{background:var(--bt-hover)}
.bt-to-bottom-btn:active{scale:.95}
.bt-earlier>:is(.bt-astack,.bt-urow,.bt-event):not(:hover):not(:focus-within),.bt-dialog-log>:is(.bt-astack,.bt-urow,.bt-event):not(:hover):not(:focus-within),[class*="_flowItem"][data-chat-flow-kind]:not(:nth-last-child(-n+12)):not(:hover):not(:focus-within){content-visibility:auto;contain-intrinsic-size:auto 120px}
@media (prefers-reduced-motion:reduce){.bt-news,.bt-to-bottom,[class*="_toBottomSlot"]>button{animation:none}}
.bt-new-sep{display:flex;align-items:center;gap:8px;margin:14px 0 8px;padding:2px 0;font-size:11px;line-height:14px;font-weight:500;letter-spacing:.02em;text-transform:uppercase;color:var(--bt-accent);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-new-sep::before,.bt-new-sep::after{content:"";flex:1;height:1px;background:color-mix(in srgb,var(--bt-accent) 20%,transparent)}
.bt-open-new{display:flex;flex-direction:column}
.bt-open-new .bt-new-sep{margin:18px 0 0}
.bt-open-new .bt-time-sep{height:16px;margin:32px 0 2px}
.bt-earlier{display:flex;flex-direction:column;gap:6px}
.bt-earlier-top{display:flex;justify-content:center;align-items:center;height:34px;flex:none}
.bt-earlier-top .bt-soft{height:28px;font-size:12px;padding:0 12px}
.bt-urow{display:flex;justify-content:flex-end}
.bt-ububble{max-width:min(560px,78%);background:var(--bt-user);color:var(--bt-user-ink);border-radius:18px;padding:7px 12px;font-size:14px;line-height:20px;box-sizing:border-box;overflow-wrap:anywhere}
.bt-ububble [class*="_markdown"],.bt-ububble a{color:inherit!important}
.bt-ububble p{margin:0;line-height:22px}
.bt-uimages{display:block;font-size:12px;opacity:.7}
.bt-utime{margin-top:-4px;font-size:11px;line-height:14px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bt-earlier .bt-event{margin:4px 0}
.bt-part-line{display:flex;align-items:center;gap:10px;margin:10px 0 6px;font-size:11px;line-height:14px;color:var(--bt-ink-3)}
.bt-part-line::before,.bt-part-line::after{content:"";flex:1;height:1px;background:var(--bt-line)}`
