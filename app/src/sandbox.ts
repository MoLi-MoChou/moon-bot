// Moon Bot patch: an AppImage cannot carry Chromium's setuid sandbox helper, so Chromium
// needs unprivileged user namespaces. Where the kernel or AppArmor forbids them (Ubuntu
// 23.10 and later by default), the app would abort at start; there it runs without the
// sandbox, as most Electron AppImages do. The window only shows the app's own local page.
import { readFileSync } from 'node:fs'

const read = (path) => { try { return readFileSync(path, 'utf8').trim() } catch { return undefined } }

/** @returns {boolean} whether this process should pass --no-sandbox */
export function needsNoSandbox({ platform = process.platform, env = process.env, readText = read } = {}) {
  if (platform !== 'linux' || !env.APPIMAGE) return false
  if ([env.MOON_BOT_SANDBOX, env.MOCHOU_SANDBOX, env.DSH_BOT_SANDBOX].includes('1')) return false
  if (readText('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1') return true
  if (readText('/proc/sys/kernel/unprivileged_userns_clone') === '0') return true
  if (readText('/proc/sys/user/max_user_namespaces') === '0') return true
  return false
}
