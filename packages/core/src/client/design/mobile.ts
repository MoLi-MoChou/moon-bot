// The narrow-screen layout shared by both hosts: panels, dialogs and menus take the whole
// viewport, and touch-sized targets where the pointer is a finger. The frame around them
// (drawer, composer, safe areas) belongs to the host and lives in app/ui/src/app.css.
export const MOBILE_CSS = `
@media (max-width:640px){
/* Phone framing: the header pill and the composer own the top and bottom strips, so the
   status notice and the failure toast move out of their way instead of covering them. */
body{--bt-notice-top:calc(env(safe-area-inset-top) + 64px);--bt-toast-bottom:calc(env(safe-area-inset-bottom) + 96px)}
/* The details panel and the new-chat sheet take the whole width, over the conversation,
   clear of the phone's status bar. */
.bt-panel{width:100vw!important;border-left:0;padding-top:env(safe-area-inset-top);box-sizing:border-box}
.bt-panel-grip{display:none}
.bt-pane{left:0!important;right:0;width:auto!important;padding-top:env(safe-area-inset-top);box-sizing:border-box}
/* Settings: full screen, the page list a scrolling strip above the page it selects. */
.bt-settings-layer{inset:0;align-items:stretch;justify-content:stretch}
.bt-settings{--bt-set-w:100vw;--bt-set-h:100dvh;flex-direction:column;width:100vw;height:100dvh;padding-top:env(safe-area-inset-top);border:0;border-radius:0;box-sizing:border-box}
.bt-settings-nav{width:100%;flex:none;flex-direction:row;align-items:center;gap:2px;overflow-x:auto;overflow-y:hidden;padding:8px 10px;border-right:0;border-bottom:.5px solid var(--bt-line);background:var(--bt-sidebar);scrollbar-width:none}
.bt-settings-nav::-webkit-scrollbar{display:none}
.bt-settings-nav>.bt-thumb{display:none}
.bt-settings-item{flex:none;min-height:40px;padding:8px 10px}
.bt-settings-shell{margin-top:0}
.bt-settings-main{width:100%;height:auto;flex:1;min-height:0}
.bt-settings-head{padding:10px 56px 8px 16px}
.bt-settings-scroll{padding:12px 16px calc(24px + env(safe-area-inset-bottom))}
.bt-settings-usage[data-off]{left:0;width:100%}
.bt-settings-close{top:calc(64px + env(safe-area-inset-top));right:12px;z-index:3}
/* The memory dialog is full screen at this width already; keep its feet above the home bar. */
.bt-mem{box-sizing:border-box;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
.bt-mem-foot{padding-bottom:calc(12px + env(safe-area-inset-bottom))}
/* The command palette becomes a sheet whose list fills the screen. */
.bt-palette-layer{inset:0}
.bt-palette{top:0;left:0;width:100vw;height:100dvh;max-height:100dvh;padding-top:env(safe-area-inset-top);border:0;border-radius:0;box-sizing:border-box;transform:none}
.bt-palette-list{flex:1;height:auto}
/* The appearance row gives its theme cards the whole width, so they wrap instead of
   running past the dialog. */
.bt-set-row:has(.bt-theme-pick){flex-direction:column;align-items:stretch;gap:8px}
.bt-set-row:has(.bt-theme-pick) .bt-set-control{display:block}
.bt-set-card,.bt-set-control{min-width:0}
.bt-theme-pick{flex-wrap:wrap;justify-content:flex-start}
/* Menus, pickers and popovers stay inside the viewport. */
.bt-menu{max-width:calc(100vw - 16px)}
.bt-avedit{width:min(300px,calc(100vw - 24px))}
.bt-drop{left:8px;width:calc(100% - 16px)}
.bt-to{padding:6px 10px}
/* Inputs at 16px keep iOS from zooming the page when one takes focus. */
.bt-to input,.bt-nc-card textarea,.bt-mem-input,.bt-q-input,.bt-palette-head input{font-size:16px}
}
@media (pointer:coarse){
/* Fingers, not pointers: the primary controls and every list row keep a 44px target. */
.bt-row{min-height:48px}
.bt-menu button{min-height:44px}
.bt-option{min-height:44px}
.bt-settings-item{min-height:44px}
.bt-q-opt{min-height:44px}
.bt-send{height:44px;min-width:44px}
.bt-soft{height:44px}
.bt-icon-btn{width:40px;height:40px}
.bt-settings-close{width:44px;height:44px}
.bt-palette-row{height:56px}
[data-composer-card] button[class*="_primary"]{width:44px!important;height:44px!important}
}
`
