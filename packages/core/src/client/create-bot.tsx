import { createElement as h, useEffect, useRef, useState } from 'react'
import { BotMark } from './mark.tsx'
import { CharacterGrid, avatarImage } from './bot-settings.tsx'
import { DEFAULT_SHAPES, DEFAULT_COLORS } from './characters.ts'
import { ChevronLeftIcon, CloseIcon } from './icons.tsx'
import { useEscape } from './overlay-hooks.ts'
import { createPayload, freshBotName, startModel } from './bot-draft.ts'
import { ModelMenu } from './model-menu.tsx'
import { hostText, t } from './i18n.ts'
import { nameProblem } from 'moon-bot-contracts'
import type { DraftRoster } from './bot-draft.ts'
// The roster fields the form reads; the rest of a roster passes through untouched.
export type CreateRoster = DraftRoster
export interface CreateBotActions {
  createBot: (payload: Record<string, unknown>) => Promise<{
    id: string
  }>
  closeOverlay: () => void
}
export interface CreateBotProps {
  roster: CreateRoster
  actions: CreateBotActions
  start?:
    | {
        name?: string
      }
    | undefined
  brief?: string
  onBack: () => void
  canGoBack: boolean
  onCreated: (bot: { id: string }) => void
  inline?: boolean
}
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!
const randomLook = (avoid: { shape?: string; color?: string } = {}) => {
  const shapes = DEFAULT_SHAPES.filter(shape => shape !== avoid.shape)
  const colors = DEFAULT_COLORS.filter(color => color !== avoid.color)
  return { shape: pick(shapes), color: pick(colors) }
}
// The new-Bot form: look first, then name and model. Nothing exists until Create.
// `inline` drops the pane's header for a form shown inside Settings.
export function CreateBot({
  roster,
  actions,
  start,
  brief = '',
  onBack,
  canGoBack,
  onCreated,
  inline = false,
}: CreateBotProps) {
  const [look, setLook] = useState(() => randomLook())
  const [image, setImage] = useState<string | null>(null)
  const [name, setName] = useState(start?.name ?? '')
  const [model, setModel] = useState(() => startModel(roster))
  const [effort, setEffort] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  useEscape(onBack)
  // Inside Settings the form opens below other sections, so it scrolls itself into view.
  useEffect(() => {
    if (inline) frame.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])
  const fallbackName = freshBotName(roster, t('New Bot'))
  const finalName = name.trim() || fallbackName
  const clash = roster.bots.some(bot => bot.name.toLowerCase() === finalName.toLowerCase())
  const problem = nameProblem(finalName)
  const create = async () => {
    if (busy || clash || problem) return
    setError('')
    setBusy(true)
    try {
      const bot = await actions.createBot(
        createPayload({ name: finalName, look, image: image ?? undefined, model, effort, brief }),
      )
      onCreated(bot)
    } catch (failure) {
      setError(
        (
          failure as {
            message?: string
          } | null
        )?.message ?? String(failure),
      )
      setBusy(false)
    }
  }
  const upload = (file: File | undefined) => {
    if (!file) return
    setError('')
    avatarImage(file).then(
      value => {
        setImage(typeof value === 'string' ? value : null)
      },
      failure => setError(failure?.message ?? String(failure)),
    )
  }
  const previewLook = image ? { ...look, image } : look
  const card = (
    <div className='bt-create-card'>
      <div className='bt-create-preview'>
        <span key={`${look.shape}:${look.color}:${image ? 'photo' : ''}`} className='bt-create-pop'>
          <BotMark look={previewLook} bot={{ id: 'new-bot' }} size={88} live gaze pokeable />
        </span>
        <span className='bt-create-name'>{finalName}</span>
      </div>
      <div className='bt-create-step'>{t('Look')}</div>
      <div className='bt-create-looks'>
        <CharacterGrid
          look={look}
          hasPhoto={Boolean(image)}
          onShape={(shape: string) => {
            setImage(null)
            setLook(current => ({ ...current, shape }))
          }}
          onColor={(color: string) => {
            setImage(null)
            setLook(current => ({ ...current, color }))
          }}
        />
        <div className='bt-actions bt-create-lookbar'>
          <button
            type='button'
            className='bt-soft bt-soft-sm'
            onClick={() => {
              setImage(null)
              setLook(current => randomLook(current))
            }}>
            {t('Shuffle')}
          </button>
          <button type='button' className='bt-soft bt-soft-sm' onClick={() => fileRef.current?.click()}>
            {image ? t('Replace photo') : t('Upload photo')}
          </button>
          {image ? (
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => setImage(null)}>
              {t('Remove photo')}
            </button>
          ) : null}
          <input
            ref={fileRef}
            type='file'
            accept='image/png,image/jpeg,image/webp,image/gif'
            hidden
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              upload(file)
            }}
          />
        </div>
      </div>
      <label className='bt-field'>
        <span className='bt-field-label'>{t('Name')}</span>
        <input
          className='bt-input'
          autoFocus={!inline}
          value={name}
          placeholder={fallbackName}
          maxLength={40}
          aria-label={t('Name')}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void create()
            }
          }}
        />
        {problem ? (
          <span className='bt-note bt-danger'>{hostText(problem)}</span>
        ) : clash ? (
          <span className='bt-note bt-danger'>{t('A Bot named {name} already exists', { name: finalName })}</span>
        ) : null}
      </label>
      <div className='bt-field'>
        <span className='bt-field-label'>{t('Model')}</span>
        <ModelMenu
          bot={{ id: 'new-bot', name: finalName, model: model || undefined, effort }}
          roster={roster}
          actions={actions}
          wide
          onPick={ref => {
            setModel(ref)
            setEffort(undefined)
          }}
          onPickEffort={setEffort}
        />
        <span className='bt-note'>
          {(roster.models ?? []).length > 0
            ? t('The Bot runs on this model. You can change it later in its details.')
            : t("Add a provider and a model in Moon Bot first, or pick one in the Bot's chat later.")}
        </span>
      </div>
      {error ? (
        <div className='bt-error' role='alert' style={{ padding: 0 }}>
          {error}
        </div>
      ) : null}
      <div className='bt-create-foot'>
        <button type='button' className='bt-soft' onClick={onBack}>
          {canGoBack ? t('Back') : t('Cancel')}
        </button>
        <button
          type='button'
          className='bt-send bt-create-go'
          disabled={busy || clash || Boolean(problem)}
          onClick={() => void create()}>
          {busy ? t('Creating…') : t('Create')}
        </button>
      </div>
    </div>
  )
  if (inline)
    return (
      <div ref={frame} className='bt-create-inline' role='group' aria-label={t('Create Bot')}>
        {card}
      </div>
    )
  return (
    <div className='bt-create' role='dialog' aria-label={t('Create Bot')}>
      <div className='bt-create-head'>
        {canGoBack ? (
          <button type='button' className='bt-icon-btn' aria-label={t('Back to new chat')} onClick={onBack}>
            <ChevronLeftIcon />
          </button>
        ) : (
          <span className='bt-create-gap' />
        )}
        <span className='bt-create-title'>{t('Create Bot')}</span>
        <button type='button' className='bt-icon-btn' aria-label={t('Close')} onClick={() => actions.closeOverlay()}>
          <CloseIcon />
        </button>
      </div>
      <div className='bt-create-body'>{card}</div>
    </div>
  )
}
