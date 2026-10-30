// The capability library keeps the settings vocabulary: a card of rows, a status chip on
// each, and a detail block that opens in place. Tokens only.
export const CAPABILITY_CSS = `
.bt-cap-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:0 4px}
.bt-cap-head h3{margin:0;padding:0}
.bt-cap-head-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.bt-cap-head-actions .bt-soft{display:inline-flex;align-items:center;gap:4px}
.bt-cap-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 4px}
.bt-cap-toolbar .bt-market-search{flex:1 1 220px;max-width:none}
.bt-cap-group{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.bt-cap-group-head{display:flex;align-items:center;gap:6px;padding:0 4px;font-size:12px;line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-cap-count{font-size:11px;line-height:14px;padding:1px 6px;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-3);font-weight:500}
.bt-cap-row{display:flex;flex-direction:column;min-width:0}
.bt-cap-summary{display:flex;align-items:center;gap:8px;width:100%;min-height:56px;padding:8px 12px;border:0;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;box-sizing:border-box}
.bt-cap-summary:hover{background:var(--bt-hover)}
.bt-cap-summary:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-chevron[data-open=true] svg{transform:rotate(90deg)}
.bt-chevron svg{transition:transform .15s ease}
.bt-cap-chips{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:4px;flex-wrap:wrap;max-width:50%}
.bt-cap-chip{display:inline-flex;align-items:center;font-size:11px;line-height:14px;padding:2px 7px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.bt-cap-chip[data-tone=ready]{background:color-mix(in srgb,var(--bt-green) 14%,transparent);color:var(--bt-green)}
.bt-cap-chip[data-tone=warn]{background:color-mix(in srgb,var(--bt-warn) 16%,transparent);color:var(--bt-warn)}
.bt-cap-chip[data-tone=error]{background:color-mix(in srgb,var(--bt-danger) 14%,transparent);color:var(--bt-danger)}
.bt-cap-chip[data-tone=quiet]{background:var(--bt-hover);color:var(--bt-ink-3)}
.bt-cap-detail{display:flex;flex-direction:column;gap:10px;padding:2px 12px 12px 36px;border-top:.5px solid var(--bt-line)}
.bt-cap-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:8px}
.bt-cap-desc{margin:0;font-size:12px;line-height:17px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-cap-notice{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--bt-accent) 10%,transparent);color:var(--bt-accent);font-size:12px;line-height:16px}
.bt-cap-notice[data-tone=warn]{background:color-mix(in srgb,var(--bt-warn) 12%,transparent);color:var(--bt-warn)}
.bt-cap-notice[data-tone=error]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--bt-danger)}
.bt-cap-notice[data-tone=ready]{background:color-mix(in srgb,var(--bt-green) 12%,transparent);color:var(--bt-green)}
.bt-cap-notice span{flex:1;min-width:160px;overflow-wrap:anywhere}
.bt-cap-section{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
.bt-cap-label{font-size:12px;line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-cap-bots{display:flex;gap:4px;flex-wrap:wrap}
.bt-cap-tools{display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:0;list-style:none}
.bt-cap-tools li{font-size:11px;line-height:14px;padding:2px 7px;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2)}
.bt-cap-tools code{font:inherit;overflow-wrap:anywhere}
.bt-cap-confirm{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--bt-danger) 8%,transparent)}
.bt-cap-confirm-copy{font-size:12px;line-height:17px;color:var(--bt-danger)}
.bt-cap-actions{justify-content:flex-end;flex-wrap:wrap;padding-top:2px}
.bt-cap-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 16px;text-align:center;border:1px dashed var(--bt-line);border-radius:12px;margin-top:10px}
.bt-cap-empty-icon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2)}
.bt-cap-empty-title{font-size:14px;line-height:20px;font-weight:600}
.bt-cap-empty .bt-set-hint{max-width:360px}
.bt-cap-form-title{font-size:13px;line-height:18px;font-weight:600}
.bt-custom-summary{cursor:default}
.bt-custom-summary:hover{background:none}
.bt-custom-detail{padding:0 12px 8px 48px}
.bt-custom-form{padding:8px 0 4px}
.bt-custom-form .bt-input{font-size:16px}
.bt-custom-actions{flex-wrap:wrap;justify-content:flex-end}
.bt-cap-ok{display:inline-flex;align-items:center;gap:4px}
.bt-cap-test-tools{font-size:11px;line-height:14px;overflow-wrap:anywhere;color:inherit}
.bt-cap-form-fields{display:flex;flex-direction:column}
.bt-danger-soft{color:var(--bt-danger)}
.bt-field-error{font-size:12px;line-height:16px;color:var(--bt-danger)}
.bt-input-error{border-color:var(--bt-danger)}
@media (max-width:640px){
.bt-cap-summary{flex-wrap:wrap}
.bt-cap-chips{max-width:100%;width:100%;justify-content:flex-start;padding-left:22px}
.bt-cap-detail{padding-left:12px}
.bt-cap-head-actions,.bt-cap-empty .bt-connector-form-row,.bt-cap-actions,.bt-cap-confirm .bt-connector-form-row,.bt-cap-notice,.bt-custom-actions{width:100%}
.bt-cap-head-actions .bt-soft,.bt-cap-empty .bt-soft,.bt-cap-actions .bt-soft,.bt-cap-confirm .bt-soft,.bt-cap-notice .bt-soft,.bt-custom-actions .bt-soft{min-height:44px}
.bt-cap-toolbar .bt-market-search{max-width:none}
}
@media (prefers-reduced-motion:reduce){.bt-chevron svg{transition:none}}
`
