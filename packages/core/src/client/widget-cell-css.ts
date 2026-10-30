export const WIDGET_CSS = `
.bt-widget-stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.bt-widget-stack>.bt-q-badge{align-self:flex-start}
.bt-widget-metric{display:flex;flex-direction:column;gap:1px;min-width:0}
.bt-widget-metric-label{font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-widget-metric-value{font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-widget-metric[data-tone=good] .bt-widget-metric-value{color:var(--bt-green)}
.bt-widget-metric[data-tone=warn] .bt-widget-metric-value{color:var(--bt-star)}
.bt-widget-metric[data-tone=bad] .bt-widget-metric-value{color:var(--bt-danger)}
.bt-widget-table{max-width:100%;overflow-x:auto;border:.5px solid var(--bt-line-2);border-radius:10px}
.bt-widget-table table{border-collapse:collapse;min-width:100%;font-size:13px;line-height:18px}
.bt-widget-table th{padding:6px 10px;font-weight:500;text-align:start;white-space:nowrap;color:var(--bt-ink-2);border-bottom:.5px solid var(--bt-line-2)}
.bt-widget-table td{padding:6px 10px;max-width:280px;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-widget-table tbody tr+tr td{border-top:.5px solid var(--bt-line)}
.bt-widget-form{display:flex;flex-direction:column;gap:8px;margin:0}
.bt-widget-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.bt-widget-field-label{font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-widget-field .bt-q-field:has(.bt-q-input:disabled){cursor:default;opacity:.75}
.bt-widget-progress{display:flex;flex-direction:column;gap:5px;min-width:0}
.bt-widget-progress-label{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-widget-progress-track{height:6px;border-radius:999px;background:var(--bt-hover);overflow:hidden}
.bt-widget-progress-fill{height:100%;border-radius:inherit;background:var(--bt-accent)}
.bt-q-raised .bt-widget-stack{padding:0 16px 14px}
.bt-q-raised .bt-widget-stack>.bt-q-list{padding:0}
`;

