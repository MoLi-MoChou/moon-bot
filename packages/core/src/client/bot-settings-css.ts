export const BOT_SETTINGS_CSS = `
.bt-bs{display:flex;flex-direction:column;gap:18px}
.bt-bs-hero{display:flex;align-items:center;gap:14px;padding:2px 4px}
.bt-bs-who{display:flex;flex-direction:column;min-width:0;gap:2px}
.bt-bs-name{font-size:17px;line-height:24px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-bs-sub{font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-bs .bt-avedit{left:0;transform:none}
.bt-bs-row .bt-model-trigger{flex:none;max-width:64%}
.bt-bs-danger .bt-bs-label{color:var(--bt-danger)}
.bt-bs-danger[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 8%,transparent)}
.bt-bs-danger[data-confirm]:hover{background:color-mix(in srgb,var(--bt-danger) 12%,transparent)}
.bt-avedit :is(.bt-shapes,.bt-colors,.bt-dropzone){animation:bt-veil-in .18s ease-out}
.bt-reset-panel{padding:4px 0 10px}
.bt-reset-part{display:flex;gap:8px;align-items:flex-start;padding:6px 12px;cursor:pointer}
.bt-reset-part input{margin-top:2px;accent-color:var(--bt-accent)}
.bt-reset-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.bt-reset-label{color:var(--bt-ink);font-size:13px}
.bt-reset-loss{display:flex;flex-direction:column;gap:4px;margin:8px 12px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--bt-danger) 7%,transparent);border:.5px solid color-mix(in srgb,var(--bt-danger) 25%,transparent)}
.bt-reset-loss-title{color:var(--bt-danger);font-size:12px;font-weight:600}
.bt-reset-loss-line{color:var(--bt-ink-2);font-size:12px;line-height:1.5}
.bt-reset-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 12px}
.bt-reset-question{color:var(--bt-ink);font-size:13px}
.bt-reset-panel>.bt-soft{margin-left:12px}
.bt-pro-card{padding:2px 12px 12px}
.bt-pro{display:flex;flex-direction:column;gap:10px}
.bt-pro-hint{margin:0;color:var(--bt-ink-2);font-size:12px;line-height:1.5}
.bt-pro-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.bt-pro-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:.5px solid var(--bt-line)}
.bt-pro-row-copy{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.bt-pro-topics{color:var(--bt-ink);font-size:13px}
.bt-pro-meta{color:var(--bt-ink-2);font-size:11.5px;line-height:1.4}
.bt-pro-danger{color:var(--bt-danger)}
.bt-pro-form{display:flex;flex-direction:column;gap:8px;padding:10px 0}
.bt-pro-inline{display:flex;gap:8px;flex-wrap:wrap}
.bt-pro-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px}
.bt-pro-narrow{flex:0 0 auto;min-width:84px}
.bt-pro-label{color:var(--bt-ink-2);font-size:12px}
.bt-pro-field input{padding:6px 8px;border-radius:8px;border:.5px solid var(--bt-line);background:var(--bt-surface);color:var(--bt-ink);font-size:13px}
.bt-pro-error{color:var(--bt-danger);font-size:12px}
.bt-pro-add{display:inline-flex;align-items:center;gap:4px;align-self:flex-start}
.bt-pro-review{display:flex;flex-direction:column;gap:8px;margin-top:6px;padding-top:10px;border-top:.5px solid var(--bt-line)}
.bt-pro-review-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-pro-candidates{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.bt-pro-candidate{display:flex;flex-direction:column;gap:4px;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--bt-ink) 3%,transparent)}
.bt-pro-candidate-text{margin:0;color:var(--bt-ink);font-size:13px;line-height:1.45}
.bt-pro-candidate-why{margin:0;color:var(--bt-ink-2);font-size:12px}
.bt-pro-evidence{margin:0;padding-left:16px;color:var(--bt-ink-2);font-size:11.5px;line-height:1.5}
.bt-pro-outcome{font-size:11.5px;color:var(--bt-ink-2)}
.bt-pro-outcome[data-would=send]{color:var(--bt-accent)}
.bt-pro-outcome[data-would=drop]{color:var(--bt-danger)}
.bt-urow[data-proactive] .bt-ububble{border:.5px solid color-mix(in srgb,var(--bt-accent) 35%,transparent);background:color-mix(in srgb,var(--bt-accent) 6%,transparent)}
.bt-pro-stats{margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--bt-ink) 4%,transparent);color:var(--bt-ink-2);font-size:11.5px;line-height:1.5}
.bt-upmark{display:inline-block;margin-bottom:4px;padding:1px 6px;border-radius:999px;font-size:10.5px;color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 12%,transparent)}
@media (prefers-reduced-motion:reduce){.bt-avedit :is(.bt-shapes,.bt-colors,.bt-dropzone){animation:none}}
`
