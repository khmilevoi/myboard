import { action, atom, computed, wrap } from '@reatom/core'
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

  // Every upload, failure and removal belongs to the cat it was started for (its memoized
  // `CatModel`, one per cat id): switching cats mid-upload never shows or blocks another cat's.
  type Pending = { target: CatModel; url: string }
  const uploads = atom<readonly Pending[]>([], `${name}.uploads`)
  const failures = atom<ReadonlySet<CatModel>>(new Set<CatModel>(), `${name}.failures`)
  const removals = atom<ReadonlySet<CatModel>>(new Set<CatModel>(), `${name}.removals`)

  const without = <T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => {
    const next = new Set(set)
    next.delete(item)
    return next
  }

  const upload = action(async (target: CatModel, image: Blob): Promise<StorageError | void> => {
    failures.set(without(failures(), target))
    const pending: Pending = { target, url: deps.createObjectUrl(image) }
    uploads.set([...uploads(), pending])
    const result = await wrap(target.uploadAvatar(image))
    uploads.set(uploads().filter((entry) => entry !== pending))
    deps.revokeObjectUrl(pending.url)
    if (result instanceof Error) {
      console.warn('[cats] the avatar upload failed', result)
      failures.set(new Set<CatModel>(failures()).add(target))
      return result
    }
  }, `${name}.upload`)

  /** The chosen cat's prepared image while it uploads, drawn dimmed in place of its avatar (C). */
  const preview = computed(() => {
    const current = cat()
    return uploads().findLast((entry) => entry.target === current)?.url ?? null
  }, `${name}.preview`)
  const uploading = computed(() => preview() !== null, `${name}.uploading`)
  const error = computed(() => {
    const current = cat()
    return current !== null && failures().has(current) ? AVATAR_UPLOAD_ERROR : null
  }, `${name}.error`)

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
    const current = cat()
    if (current !== null) failures.set(without(failures(), current))
    await wrap(crop.openFile(file))
  }, `${name}.pick`)

  /** "Убрать фото": the slot empties, and every avatar of the cat shows its letter again. */
  const remove = action(async (): Promise<StorageError | void> => {
    const target = cat()
    if (target === null) return
    removals.set(new Set<CatModel>(removals()).add(target))
    const result = await wrap(target.removeAvatar())
    removals.set(without(removals(), target))
    if (result instanceof Error) {
      console.warn('[cats] removing the avatar failed', result)
      return result
    }
  }, `${name}.remove`)

  const removing = computed(() => {
    const current = cat()
    return current !== null && removals().has(current)
  }, `${name}.removing`)

  return { crop, preview, uploading, removing, error, pick, remove }
}
