import { Fragment, type Ref, createElement as h, useEffect, useRef, useState } from 'react'
import { paintCss } from './inks.ts'
import {
  CHARACTERS,
  PICKER_SHAPES,
  PICKER_COLUMNS,
  CHARACTER_COLORS,
  SHAPES,
  hasShape,
  shapeOf,
  bodyOf,
  maskBox,
  holes,
  nextMarkSerial,
} from './characters.ts'
import { lookOf, BotMark } from './mark.tsx'
import { modelOf } from './model-menu.tsx'
import { useGlide } from './motion.tsx'
import { t } from './i18n.ts'
import type { AvatarEditorProps, CharacterGridProps, SettingsBot, SettingsRoster } from './settings-types.ts'

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)
// Uploaded avatars are center-cropped to a small square so state.json stays light.
export async function avatarImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error(t('Choose a PNG, JPEG, WebP, or GIF image'))
  if (file.size > 25 * 1024 * 1024) throw new Error(t('Choose an image smaller than 25 MB'))
  const bitmap = await createImageBitmap(file)
  const side = 160
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('canvas 2d context unavailable')
  context.imageSmoothingQuality = 'high'
  const crop = Math.min(bitmap.width, bitmap.height)
  context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side)
  bitmap.close?.()
  for (const quality of [0.9, 0.75, 0.6]) {
    const url = canvas.toDataURL('image/webp', quality)
    if (url.startsWith('data:image/webp') && url.length < 150000) return url
  }
  const png = canvas.toDataURL('image/png')
  if (png.length < 150000) return png
  throw new Error(t('That image is too large'))
}
export function modelHint(bot: SettingsBot, roster: SettingsRoster): string {
  const shown = modelOf(bot, roster)
  if (shown === undefined) return t('Pick the model this Bot runs on.')
  if (!shown.served && (roster.models ?? []).length > 0) return t('This model is not available now. Pick another one.')
  if (bot.appliedModel && bot.appliedModel === bot.model) return t('Every message of this Bot runs on it.')
  return t('Applies from the next message.')
}
// The selection ring of a picker cell follows the shape: a 1px line 3px outside it.
function ShapeRing({ shape, size }: { shape: string; size: number }) {
  const maskId = useRef('')
  if (maskId.current === '') maskId.current = `bt-ring-${nextMarkSerial()}`
  const def = shapeOf(shape)
  const unit = def.size / size
  const markup = `<defs><mask id="${maskId.current}" ${maskBox(def.size)}>${holes(def, `<g stroke="#000" stroke-width="${6 * unit}" stroke-linejoin="round">${bodyOf(def, '#000', true)}</g>`)}</mask></defs><g mask="url(#${maskId.current})" stroke="currentColor" stroke-width="${8 * unit}" stroke-linejoin="round">${bodyOf(def, 'currentColor', true)}</g>`
  return (
    <svg
      className='bt-ring'
      viewBox={`0 0 ${def.size} ${def.size}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
// Every character shape, six to a row, then the color swatches.
export function CharacterGrid({ look, hasPhoto = false, onShape, onColor }: CharacterGridProps) {
  const shapes = [...PICKER_SHAPES, ...Object.keys(SHAPES).filter(id => !Object.hasOwn(CHARACTERS, id))]
  if (!shapes.includes(look.shape)) shapes.push(look.shape)
  const rows: string[][] = []
  for (let index = 0; index < shapes.length; index += PICKER_COLUMNS)
    rows.push(shapes.slice(index, index + PICKER_COLUMNS))
  return (
    <>
      <div className='bt-shapes' role='group' aria-label={t('Character shape')}>
        {rows.map((row, index) => (
          <div key={index} className='bt-shape-row'>
            {row.map(id => (
              <button
                key={id}
                type='button'
                className='bt-shape'
                aria-label={t(shapeOf(id).label)}
                title={t(shapeOf(id).label)}
                aria-pressed={!hasPhoto && look.shape === id}
                onClick={() => onShape(id)}>
                <ShapeRing shape={id} size={36} />
                <BotMark look={{ shape: id, color: look.color }} size={36} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className='bt-colors' role='group' aria-label={t('Character color')}>
        {CHARACTER_COLORS.map(color => (
          <button
            key={color}
            type='button'
            className='bt-color'
            aria-label={t(capitalize(color))}
            title={t(capitalize(color))}
            aria-pressed={look.color === color}
            onClick={() => onColor(color)}>
            <span style={{ background: paintCss(color) }} />
          </button>
        ))}
      </div>
    </>
  )
}
// The avatar editor: the Bot tab picks a character (every click saves), the
// Upload tab takes a photo, and Reset returns to the look the Bot id gives.
export function AvatarEditor({ bot, actions, run, onClose }: AvatarEditorProps) {
  const look = lookOf(bot)
  const [tab, setTab] = useState<'bot' | 'upload'>(look.image ? 'upload' : 'bot')
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const storedShape = bot.avatar?.shape
  const upload = (file: File | undefined): void => {
    if (file) void run(avatarImage(file).then(image => actions.updateBot(bot.id, { avatar: { ...bot.avatar, image } })))
  }
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (
        !(event.target instanceof Element) ||
        ref.current?.contains(event.target) ||
        event.target.closest('.bt-avatar-trigger')
      )
        return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  useEffect(() => {
    if (tab !== 'upload') return undefined
    const onPaste = (event: ClipboardEvent): void => {
      const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'))
      if (file) {
        event.preventDefault()
        upload(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [tab, bot])
  const hasPhoto = Boolean(look.image)
  const glide = useGlide(tab)
  return (
    <div ref={ref} className='bt-avedit' role='dialog' aria-label={t('Avatar editor')}>
      <div className='bt-avedit-top'>
        <div
          ref={glide.box as Ref<HTMLDivElement>}
          role='tablist'
          aria-label={t('Avatar source')}
          className='bt-avedit-tabs'>
          <span ref={glide.thumb as Ref<HTMLSpanElement>} className='bt-thumb' aria-hidden />
          {(
            [
              ['bot', 'Bot'],
              ['upload', 'Upload'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type='button'
              role='tab'
              className='bt-avedit-tab'
              aria-selected={tab === id}
              onClick={() => setTab(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        <button
          type='button'
          className='bt-avedit-tab bt-avedit-reset'
          title={t('Reset character to default')}
          onClick={() => run(actions.updateBot(bot.id, { avatar: null, color: null }))}>
          {t('Reset')}
        </button>
      </div>
      {tab === 'bot' ? (
        <CharacterGrid
          look={look}
          hasPhoto={hasPhoto}
          onShape={shape => run(actions.updateBot(bot.id, { avatar: { shape } }))}
          onColor={color => run(actions.updateBot(bot.id, { color }))}
        />
      ) : null}
      {tab === 'upload' ? (
        <div
          className='bt-dropzone'
          data-over={over || undefined}
          onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault()
            setOver(false)
            upload(event.dataTransfer.files?.[0])
          }}>
          {hasPhoto ? <img src={look.image} alt='' /> : null}
          <div>{t('Drag, drop, or paste an image')}</div>
          <div className='bt-actions' style={{ justifyContent: 'center' }}>
            <button type='button' className='bt-soft bt-soft-sm' onClick={() => fileRef.current?.click()}>
              {hasPhoto ? t('Replace') : t('Browse files')}
            </button>
            {hasPhoto ? (
              <button
                type='button'
                className='bt-soft bt-soft-sm'
                onClick={() =>
                  run(actions.updateBot(bot.id, { avatar: hasShape(storedShape) ? { shape: storedShape } : null }))
                }>
                {t('Remove photo')}
              </button>
            ) : null}
          </div>
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
      ) : null}
    </div>
  )
}
