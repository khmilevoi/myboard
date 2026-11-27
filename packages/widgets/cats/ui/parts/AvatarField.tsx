import { wrap } from '@reatom/core'
import { AVATAR_POLICY } from '@shared/files/contract'
import type { CatTone } from 'module-cats'
import { CatAvatar } from 'module-cats/ui/CatAvatar'
import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import {
  AvatarCropDialog,
  AvatarCropPreviewItem,
  type RenderCropPreview,
} from 'widget-sdk/ui/AvatarCropDialog'
import { Button } from 'widget-sdk/ui/button'

import { makeAvatarField } from '@/model/avatar-field'

import { useCats } from '../cats-context'

import styles from './AvatarField.module.css'
import ears from 'widget-sdk/ui/cat-ears.module.css'

const ACCEPT = AVATAR_POLICY.accept.join(',')

// Page 10, form "Обрезать фото": where the photo shows up on the board.
const CatCropPreviews = reatomMemo<{ renderPreview: RenderCropPreview }>(
  ({ renderPreview }) => (
    <>
      <AvatarCropPreviewItem caption="Профиль">
        {renderPreview(56, 'cat-crop-preview-profile')}
      </AvatarCropPreviewItem>
      <AvatarCropPreviewItem caption="Шапка карточки">
        {renderPreview(26, 'cat-crop-preview-header')}
      </AvatarCropPreviewItem>
      <AvatarCropPreviewItem caption="Переключатель">
        {renderPreview(22, 'cat-crop-preview-menu')}
      </AvatarCropPreviewItem>
    </>
  ),
  'CatCropPreviews',
)

export type AvatarFieldProps = {
  name: string
  tone: CatTone
  /** The slot's photo, if one is set. */
  photoUrl: string | null
}

/**
 * The profile's photo (page 10, "Профиль — состояния полей" A–D): the cat avatar with "Загрузить
 * фото", or "Заменить фото" and "Убрать фото"; while uploading the cropped photo dimmed under a
 * spinner (C), after a failure the letter and the alert (B).
 */
export const AvatarField = reatomMemo<AvatarFieldProps>(({ name, tone, photoUrl }) => {
  const { card } = useCats()
  // Per mount, like the weigh dialog's open state: the board tile and the fullscreen mount must
  // not both open the crop dialog.
  const [field] = useState(() => makeAvatarField(card.choice.cat, 'catsAvatarField'))
  // Outside the dialog: its content unmounts on close, the picker must not.
  const fileInput = useRef<HTMLInputElement>(null)
  const previews = useCallback(
    (renderPreview: RenderCropPreview) => <CatCropPreviews renderPreview={renderPreview} />,
    [],
  )

  const uploading = field.uploading()
  const preview = field.preview()
  const error = field.error()
  const removing = field.removing()
  const hasPhoto = photoUrl !== null || uploading

  const openPicker = () => fileInput.current?.click()
  const onPick = wrap((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    // Reset, so picking the same file again still fires change.
    event.currentTarget.value = ''
    if (file) void field.pick(file)
  })

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        {uploading && preview !== null ? (
          <span className={styles.pending}>
            <img className={cn(ears.catEars, styles.pendingImage)} src={preview} alt="" />
            <span className={styles.spinner} role="status" aria-label="Загружаем фото" />
          </span>
        ) : (
          <CatAvatar name={name} tone={tone} photoUrl={photoUrl} size="field" />
        )}
        <div className={styles.actions}>
          <Button
            type="button"
            variant="outline"
            className={styles.button}
            disabled={uploading || removing}
            onClick={wrap(openPicker)}
          >
            {hasPhoto ? 'Заменить фото' : 'Загрузить фото'}
          </Button>
          {uploading ? (
            <span className={styles.captionBusy}>Загружаем фото…</span>
          ) : photoUrl !== null ? (
            <Button
              type="button"
              variant="outline"
              className={styles.button}
              disabled={removing}
              onClick={wrap(() => void field.remove())}
            >
              Убрать фото
            </Button>
          ) : (
            <span className={styles.caption}>Без фото — буква на цвете кошки</span>
          )}
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className={styles.fileInput}
        tabIndex={-1}
        aria-hidden
        data-testid="cat-avatar-input"
        onChange={onPick}
      />
      <AvatarCropDialog
        model={field.crop}
        shape="cat"
        title="Обрезать фото"
        hint="Перетащите фото, чтобы выбрать, что попадёт в рамку."
        previewTitle="Так фото увидят на борде"
        previews={previews}
        onPickAnother={openPicker}
      />
    </div>
  )
}, 'AvatarField')
