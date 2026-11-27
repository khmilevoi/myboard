import { action, atom, computed, withAsync, withComputed, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { CatModel } from 'module-cats'
import type { StorageError } from 'widget-runtime'
import {
  makeAvatarCropModel,
  type AvatarCropDeps,
  type Size,
} from 'widget-sdk/files/avatar-crop-model'
import {
  prepareImage as prepareImageInBrowser,
  type PrepareImageOptions,
  type ImagePreset,
} from 'widget-sdk/files/prepare-image'

/** Page 10, "Профиль — состояния полей" B: the photo did not upload, the letter stays. */
export const AVATAR_UPLOAD_ERROR =
  'Не удалось загрузить фото. Попробуйте ещё раз или другой снимок.'

export type AvatarFieldDeps = {
  prepareImage: (
    file: Blob,
    preset: ImagePreset,
    options: PrepareImageOptions,
  ) => Promise<Error | Blob>
  readImageSize?: (file: Blob) => Promise<Error | Size>
  createObjectUrl: (file: Blob) => string
  revokeObjectUrl: (url: string) => void
}

export type AvatarField = ReturnType<typeof makeAvatarField>

/**
 * The profile's photo field (page 10, states A–D): pick, crop in the eared frame, upload a 256 px
 * WebP into the cat's avatar slot, then the photo or the error. The upload states belong to the
 * field, not the dialog (F20): the dialog closes once the image is prepared, and the field shows
 * the cropped photo dimmed (C) until the slot answers, or the error with the letter (B).
 *
 * The slot's `FileRef` is the only source of truth (ruling 3): nothing here writes the profile.
 */
export function makeAvatarField(
  cat: AtomLike<CatModel | null>,
  name = 'avatarField',
  overrides: Partial<AvatarFieldDeps> = {},
) {
  const deps: AvatarFieldDeps = {
    prepareImage: overrides.prepareImage ?? prepareImageInBrowser,
    readImageSize: overrides.readImageSize,
    createObjectUrl: overrides.createObjectUrl ?? ((file) => URL.createObjectURL(file)),
    revokeObjectUrl: overrides.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url)),
  }

  /** The prepared image while it uploads, drawn dimmed in place of the avatar (state C). */
  const preview = atom<string | null>(null, `${name}.preview`)
  // Another cat's failure is not this cat's: the message goes when the cat changes.
  const failed = atom(false, `${name}.failed`).extend(
    withComputed(() => {
      cat()
      return false
    }),
  )

  const upload = action(async (target: CatModel, image: Blob): Promise<StorageError | void> => {
    failed.set(false)
    const url = deps.createObjectUrl(image)
    preview.set(url)
    const result = await wrap(target.uploadAvatar(image))
    preview.set(null)
    deps.revokeObjectUrl(url)
    if (result instanceof Error) {
      console.warn('[cats] the avatar upload failed', result)
      failed.set(true)
      return result
    }
  }, `${name}.upload`).extend(withAsync())

  const uploading = computed(() => !upload.ready(), `${name}.uploading`)
  const error = computed(() => (failed() ? AVATAR_UPLOAD_ERROR : null), `${name}.error`)

  const crop = makeAvatarCropModel({
    // Only the preparation is awaited: its failure stays in the dialog, as the account's does.
    // The upload then runs on the field, and the dialog closes at once.
    upload: async (file, square) => {
      const target = cat()
      if (target === null) return new Error('no cat is chosen')
      const prepared = await wrap(deps.prepareImage(file, 'avatar', { crop: square }))
      if (prepared instanceof Error) return prepared
      void upload(target, prepared)
      return null
    },
    describeError: () => AVATAR_UPLOAD_ERROR,
    ...(deps.readImageSize ? { readImageSize: deps.readImageSize } : {}),
    createObjectUrl: deps.createObjectUrl,
    revokeObjectUrl: deps.revokeObjectUrl,
  } satisfies Partial<AvatarCropDeps> & Pick<AvatarCropDeps, 'upload' | 'describeError'>)

  /** A file from the picker: forgets the last failure and opens the crop dialog. */
  const pick = action(async (file: Blob) => {
    failed.set(false)
    await wrap(crop.openFile(file))
  }, `${name}.pick`)

  /** "Убрать фото": the slot empties, and every avatar of the cat shows its letter again. */
  const remove = action(async (): Promise<StorageError | void> => {
    const target = cat()
    if (target === null) return
    const result = await wrap(target.removeAvatar())
    if (result instanceof Error) {
      console.warn('[cats] removing the avatar failed', result)
      return result
    }
  }, `${name}.remove`).extend(withAsync())

  const removing = computed(() => !remove.ready(), `${name}.removing`)

  return { crop, preview, uploading, removing, error, pick, remove }
}
