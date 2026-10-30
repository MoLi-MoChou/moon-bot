import { Fragment, createElement as h, useEffect, useState } from 'react'
import { t } from './i18n.ts'
// Settings → Remote agents (2026-10-27 remote-agents): the invites an external agent
// dials in with, and who is connected right now. Creating one shows the token exactly
// once — the host keeps only its hash — together with the one command that attaches a
// CLI on the other machine; revoking cuts the live connection the same second.
export interface RelayInvite {
  agentId: string
  createdAt: number
  revokedAt: number | null
  lastSeenAt: number | null
  online: boolean
}
export interface RelayActions {
  relayInvites: () => Promise<{ invites: readonly RelayInvite[] }>
  relayInviteCreate: (agentId: string) => Promise<{ agentId: string; token: string }>
  relayInviteRevoke: (agentId: string) => Promise<{ invites: readonly RelayInvite[] }>
}
/** The command that attaches a CLI to this deployment; the browser knows the origin. */
export const connectCommand = (origin: { protocol: string; host: string }, token: string): string => {
  const scheme = origin.protocol === 'https:' ? 'wss' : 'ws'
  return `npx moon-bot-connect --url ${scheme}://${origin.host}/api/bot/relay --token ${token}`
}
const when = (at: number | null): string => (at === null ? '' : new Date(at).toLocaleString())
function InviteRow({
  invite,
  relay,
  onChanged,
}: {
  invite: RelayInvite
  relay: RelayActions
  onChanged: (invites: readonly RelayInvite[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const revoked = invite.revokedAt !== null
  return (
    <div className='bt-relay-row' data-online={invite.online ? '' : undefined} data-revoked={revoked ? '' : undefined}>
      <span className='bt-relay-dot' aria-hidden />
      <span className='bt-relay-copy'>
        <span className='bt-relay-name'>{invite.agentId}</span>
        <span className='bt-relay-sub'>
          {revoked ? t('Revoked') : invite.online ? t('Connected') : t('Not connected')}
          {invite.online
            ? ''
            : invite.lastSeenAt === null
              ? ''
              : ` · ${t('Last seen {when}', { when: when(invite.lastSeenAt) })}`}
        </span>
      </span>
      {revoked ? null : (
        <button
          type='button'
          className='bt-soft bt-soft-sm'
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void relay
              .relayInviteRevoke(invite.agentId)
              .then(result => onChanged(result.invites))
              .finally(() => setBusy(false))
          }}>
          {t('Revoke')}
        </button>
      )}
    </div>
  )
}
export function RelayPage({ relay }: { relay: RelayActions }) {
  const [invites, setInvites] = useState<readonly RelayInvite[] | null>(null)
  const [name, setName] = useState('')
  const [made, setMade] = useState<{ agentId: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void relay
      .relayInvites()
      .then(result => setInvites(result.invites))
      .catch(failure => setError(failure?.message ?? String(failure)))
  }, [])
  const create = (): void => {
    const agentId = name.trim()
    if (busy || agentId === '') return
    setBusy(true)
    setError(null)
    void relay
      .relayInviteCreate(agentId)
      .then(result => {
        setMade(result)
        setName('')
        setCopied(false)
        return relay.relayInvites()
      })
      .then(result => setInvites(result.invites))
      .catch(failure => setError(failure?.message ?? String(failure)))
      .finally(() => setBusy(false))
  }
  const command = made === null ? '' : connectCommand(window.location, made.token)
  const copy = (): void => {
    void navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined,
    )
  }
  return (
    <>
      <section className='bt-set-section'>
        <h3>{t('Invite a remote agent')}</h3>
        <div className='bt-set-card bt-relay-card'>
          <div className='bt-relay-create'>
            <input
              className='bt-input'
              value={name}
              placeholder={t('Name it, e.g. kai-laptop')}
              aria-label={t('Agent name')}
              maxLength={120}
              spellCheck={false}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') create()
              }}
            />
            <button type='button' className='bt-soft bt-soft-sm' disabled={busy || name.trim() === ''} onClick={create}>
              {busy ? t('Creating…') : t('Create invite')}
            </button>
          </div>
          <p className='bt-set-hint'>
            {t('The agent on the other machine runs one command to join; it needs no open port.')}
          </p>
          {made !== null ? (
            <div className='bt-relay-made'>
              <p className='bt-relay-warn'>{t('Copy it now — it is shown once.')}</p>
              <code className='bt-relay-command'>{command}</code>
              <button type='button' className='bt-soft bt-soft-sm' onClick={copy}>
                {copied ? t('Copied') : t('Copy command')}
              </button>
            </div>
          ) : null}
          {error !== null ? (
            <div className='bt-connector-error' role='alert'>
              {error}
            </div>
          ) : null}
        </div>
      </section>
      <section className='bt-set-section'>
        <h3>{t('Invited agents')}</h3>
        <div className='bt-set-card'>
          {invites === null ? (
            <div className='bt-set-row'>
              <span className='bt-set-hint'>{t('Loading…')}</span>
            </div>
          ) : invites.length === 0 ? (
            <div className='bt-set-row'>
              <span className='bt-set-hint'>{t('No remote agents yet.')}</span>
            </div>
          ) : (
            invites.map(invite => (
              <InviteRow key={invite.agentId} invite={invite} relay={relay} onChanged={setInvites} />
            ))
          )}
        </div>
      </section>
    </>
  )
}
export const RELAY_PAGE_CSS = `
.bt-relay-card{display:flex;flex-direction:column;gap:10px;padding:12px}
.bt-relay-create{display:flex;gap:8px;align-items:center}
.bt-relay-create .bt-input{flex:1;min-width:0}
.bt-relay-made{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:var(--bt-hover)}
.bt-relay-warn{margin:0;font-size:12px;line-height:16px;color:var(--bt-warn)}
.bt-relay-command{display:block;padding:8px 10px;border-radius:8px;background:var(--bt-main);border:1px solid var(--bt-line);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.bt-relay-row{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:48px}
.bt-relay-dot{width:8px;height:8px;border-radius:50%;background:var(--bt-ink-3);flex:none}
.bt-relay-row[data-online] .bt-relay-dot{background:var(--bt-green)}
.bt-relay-row[data-revoked] .bt-relay-dot{background:var(--bt-line-2)}
.bt-relay-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-relay-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-relay-sub{font-size:11px;line-height:15px;color:var(--bt-ink-3)}
.bt-relay-row[data-revoked] .bt-relay-name{color:var(--bt-ink-3);text-decoration:line-through}
`
