// The password page of web mode: one field, no scripts, in the Moon theme, light or dark
// with the system. The Moon Bot tile comes from assets/icons (scripts/icon.py).
import { readFileSync } from 'node:fs'
const tile = name => `data:image/png;base64,${readFileSync(new URL(`../assets/icons/${name}.png`, import.meta.url)).toString('base64')}`
const LOGO = tile('moon-bot-96'), LOGO_DARK = tile('moon-bot-dark-96'), FAVICON = tile('moon-bot-32')
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export function loginPage({ error = false, wait = false } = {}) {
  const note = wait ? '尝试次数过多，请 10 分钟后再试。 Too many tries, wait 10 minutes.' : error ? '密码不对。 Wrong password.' : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Moon Bot · 登录</title><link rel="icon" type="image/png" href="${FAVICON}"><style>
:root{color-scheme:light dark;--bg:#fcfafd;--glow:#efe6fa;--card:#fff;--ink:#2a2233;--ink2:rgba(42,34,51,.6);--line:rgba(70,45,110,.12);--accent:#8a6bd1;--btn:#8a6bd1;--btn-ink:#fff;--logo:url("${LOGO}")}
@media (prefers-color-scheme:dark){:root{--bg:#17131d;--glow:#2a2138;--card:#221c2b;--ink:#f1ecf7;--ink2:rgba(241,236,247,.6);--line:rgba(210,190,255,.14);--accent:#b9a3f5;--btn:#b9a3f5;--btn-ink:#1a1422;--logo:url("${LOGO_DARK}")}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 600px at 50% 20%,var(--glow),var(--bg));color:var(--ink);font:15px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
form{width:min(360px,92vw);background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px;box-shadow:0 18px 48px -20px rgba(90,60,150,.35)}
.logo{width:56px;height:56px;margin:0 0 14px;background:var(--logo) center/contain no-repeat}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:var(--ink2);font-size:13px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:999px;background:var(--btn);color:var(--btn-ink);font:inherit;font-weight:600;cursor:pointer}
.err{color:#e5484d;font-size:13px;margin-top:10px;min-height:1em}
</style></head><body><form method="post" action="/login">
<div class="logo" role="img" aria-label="Moon Bot"></div><h1>Moon Bot</h1><p>输入访问密码 · Enter the access password</p>
<input type="password" name="password" autocomplete="current-password" autofocus required aria-label="访问密码">
<button type="submit">登录</button><div class="err" role="alert">${esc(note)}</div></form></body></html>`
}
