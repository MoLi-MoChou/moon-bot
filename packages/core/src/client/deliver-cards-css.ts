// The styles of the delivered-file cards, their preview and the library page. One sheet
// because the three travel together: the cards sit in the chat, the preview opens from
// them and from the library, and all of it rides the work-process group.
export const DELIVER_CSS = `
.bt-dcards{display:flex;flex-flow:row wrap;gap:8px;margin:4px 0 2px;max-width:100%}
.bt-dcard{display:flex;align-items:flex-start;gap:10px;width:224px;max-width:100%;padding:10px 12px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;transition:border-color .12s ease,transform .12s ease}
.bt-dcard:hover{border-color:var(--bt-line-2);transform:translateY(-1px)}
.bt-dcard:active{transform:none}
.bt-dcard:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-dcard-icon{display:flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;border-radius:8px;background:color-mix(in srgb,var(--bt-accent) 10%,transparent);color:var(--bt-accent)}
.bt-dcard-copy{display:flex;flex-direction:column;gap:1px;min-width:0}
.bt-dcard-name{font-size:13px;line-height:18px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-dcard-meta{font-size:12px;line-height:16px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-dcard-big{font-size:11px;line-height:15px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-fpreview-layer{position:fixed;inset:var(--bt-frame-chrome-top,0px) 0 0;z-index:62;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:bt-veil-in .16s ease-out}
.bt-fpreview{display:flex;flex-direction:column;width:min(720px,calc(100vw - 48px));height:min(640px,calc(100vh - 64px));border:.5px solid var(--bt-line-2);border-radius:16px;background:var(--bt-main);box-shadow:0 24px 80px rgba(0,0,0,.24);overflow:hidden;color:var(--bt-ink)}
.bt-fpreview-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:.5px solid var(--bt-line-2)}
.bt-fpreview-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.bt-fpreview-name{font-size:14px;line-height:19px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-fpreview-meta{font-size:12px;line-height:16px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-fpreview-body{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.bt-fpreview-body>pre{align-self:stretch;flex:1;overflow:auto;margin:0;padding:12px;border-radius:10px;background:var(--bt-card);box-shadow:inset 0 0 0 1px var(--bt-line);font-size:12.5px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.bt-fpreview-text{align-self:stretch;flex:1;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto}
.bt-fpreview-text pre{margin:0;padding:12px;border-radius:10px;background:var(--bt-card);box-shadow:inset 0 0 0 1px var(--bt-line);font-size:12.5px;line-height:19px;white-space:pre-wrap;overflow-wrap:anywhere}
.bt-fpreview-image{max-width:100%;max-height:100%;border-radius:8px;object-fit:contain}
.bt-fpreview-frame{width:100%;height:100%;border:0;border-radius:8px;background:var(--bt-card)}
.bt-fpreview-video{width:100%;max-height:100%;border-radius:8px;background:var(--bt-card)}
.bt-fpreview-audio{width:100%}
.bt-fpreview-none{display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;text-align:center}
.bt-fpreview-none .bt-dcard-icon{width:46px;height:46px;border-radius:12px}
.bt-fpreview-note{margin:0;font-size:12.5px;line-height:19px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-fpreview-loading{font-size:13px;color:var(--bt-ink-2)}
.bt-fpreview-foot{display:flex;justify-content:center;padding:10px 14px 14px}
.bt-fpreview-download{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 16px;border:0;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:filter .12s ease}
.bt-fpreview-download:hover{filter:brightness(1.08)}
.bt-fpreview-download[data-busy]{cursor:progress;opacity:.7}
.bt-fpreview-download:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-diff-view{align-self:stretch;flex:1;display:flex;flex-direction:column;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:18px;overflow:auto;background:var(--bt-card);border-radius:10px;box-shadow:inset 0 0 0 1px var(--bt-line);padding:6px 0}
.bt-diff-line{display:flex;align-items:baseline;padding:1px 10px;white-space:pre-wrap;word-break:break-all}
.bt-diff-num{width:34px;flex:none;color:var(--bt-ink-3);user-select:none;font-size:11px;text-align:right;margin-right:12px;opacity:.6}
.bt-diff-code{flex:1;min-width:0}
.bt-diff-add{background:color-mix(in srgb,var(--bt-green) 12%,transparent);color:var(--bt-green)}
.bt-diff-del{background:color-mix(in srgb,var(--bt-red) 12%,transparent);color:var(--bt-red)}
.bt-diff-hunk{background:color-mix(in srgb,var(--bt-accent) 10%,transparent);color:var(--bt-accent);font-weight:600}
.bt-diff-meta{color:var(--bt-ink-3);font-weight:600}
.bt-lib-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.bt-lib-filters select{width:auto;min-width:120px;flex:none}
.bt-lib-row{display:flex;align-items:center;gap:2px;width:100%;padding:0 8px;border-radius:8px}
.bt-lib-row:hover{background:var(--bt-hover)}
.bt-lib-open{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:8px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bt-lib-row .bt-dcard-icon{width:32px;height:32px}
.bt-lib-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-lib-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-lib-meta{font-size:12px;line-height:16px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){
.bt-lib-row{flex-wrap:wrap;padding:4px 4px 8px}
.bt-lib-back{margin-left:auto}
.bt-lib-back-label{display:none}
.bt-lib-filters{gap:6px}
.bt-lib-filters select{min-width:0;flex:1}
.bt-fpreview{width:calc(100vw - 16px);height:calc(100vh - 24px);border-radius:12px}
}
@media (prefers-reduced-motion:reduce){.bt-dcard,.bt-fpreview-layer{animation:none;transition:none}}
`;
