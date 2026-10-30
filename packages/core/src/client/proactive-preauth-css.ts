// Styles for the standing-permission card, kept out of the Bot settings file so that
// file stays within the line gate.
export const PREAUTH_CSS = `
.bt-pro-block{list-style:none;display:flex;flex-direction:column;gap:6px}
.bt-pro-block>.bt-pro-card,.bt-pro-block>div{padding:0}
.bt-preauth-row{align-items:flex-start}
.bt-preauth-tools{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.bt-preauth-tool{display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer}
.bt-preauth-tool[data-allowed]{opacity:.55;cursor:not-allowed}
.bt-preauth-tool input{margin-top:2px;accent-color:var(--bt-accent)}
.bt-preauth-tool-copy{display:flex;flex-direction:column;gap:1px}
.bt-preauth-audit-toggle{align-self:flex-start;background:none;border:0;padding:2px 0;color:var(--bt-accent);font-size:11.5px;cursor:pointer}
.bt-preauth-audit{list-style:none;margin:4px 0 0;padding:0 0 0 10px;color:var(--bt-ink-2);font-size:11px;line-height:1.6}
.bt-preauth-warning{margin:4px 0;padding:8px 10px;border-radius:8px;font-size:12px;background:color-mix(in srgb,var(--bt-danger) 9%,transparent);border:.5px solid color-mix(in srgb,var(--bt-danger) 30%,transparent);color:var(--bt-danger)}
.bt-preauth-note{font-size:11.5px;color:var(--bt-ink-2);line-height:1.5}
`
