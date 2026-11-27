import { atom, context, wrap } from '@reatom/core'
import type { FileRef } from '@shared/files/contract'
import { defaultCatProfile } from 'module-cats/domain/cat'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError, makeFileSlotFromApi, type FileSlotApi } from 'widget-runtime'
import { makeFakeFileSlotApi } from 'widget-runtime/storage/test/fakes'

import { AVATAR_UPLOAD_ERROR, makeAvatarField } from './avatar-field'

afterEach(() => {
  vi.restoreAllMocks()
  context.reset()
})

type Upload = FileSlotApi['upload']

/** `upload` replaces Ofelia's slot upload; Буся's slot always succeeds. */
function setup(upload?: Upload) {
  const base = makeFakeFileSlotApi()
  const slots = new Map([
    ['ofelia', makeFileSlotFromApi(upload ? { ...base, upload } : base, 'test.avatar.ofelia')],
    ['busya', makeFileSlotFromApi(makeFakeFileSlotApi(), 'test.avatar.busya')],
  ])
  // The cat's id is the key's middle segment: `cat/<id>/avatar`.
  const files = ((_scope: string, key?: string) =>
    slots.get(key?.split('/')[1] ?? '')) as NonNullable<MakeTestCatsModelOptions['files']>
  const { model } = makeTestCatsModel({
    files,
    catRegistry: [
      { id: 'c1', ts: 1, catId: 'ofelia', op: 'add' },
      { id: 'c2', ts: 2, catId: 'busya', op: 'add' },
    ],
    litterRegistry: [{ id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' }],
    profiles: {
      ofelia: defaultCatProfile('Офелия', 'ofelia'),
      busya: defaultCatProfile('Буся', 'ofelia'),
    },
  })
  const cat = atom(model.cat('ofelia'), 'test.cat')
  const prepared = new Blob(['webp'], { type: 'image/webp' })
  const prepareImage = vi.fn(async () => prepared as Error | Blob)
  const revokeObjectUrl = vi.fn()
  const field = makeAvatarField(cat, 'test.field', {
    prepareImage,
    readImageSize: async () => ({ width: 400, height: 300 }),
    createObjectUrl: (blob) => (blob === prepared ? 'blob:prepared' : 'blob:picked'),
    revokeObjectUrl,
  })
  const off = model.cat('ofelia').avatarUrl.subscribe(() => {})
  return { field, model, cat, prepared, prepareImage, revokeObjectUrl, off }
}

describe('makeAvatarField', () => {
  it('crops, closes the dialog, uploads the prepared image and shows it while uploading', async () => {
    let finish: (ref: FileRef) => void = () => {}
    const upload: Upload = () => new Promise<FileRef>((resolve) => (finish = resolve))
    const { field, model, prepared, prepareImage, revokeObjectUrl, off } = setup(upload)

    await field.pick(new Blob(['png'], { type: 'image/png' }))
    expect(field.crop.open()).toBe(true)
    await field.crop.save()

    // The crop dialog closes once the image is prepared; the field shows state C.
    expect(prepareImage).toHaveBeenCalledWith(expect.any(Blob), 'avatar', {
      crop: { x: 50, y: 0, size: 300 },
    })
    expect(field.crop.open()).toBe(false)
    expect(field.uploading()).toBe(true)
    expect(field.preview()).toBe('blob:prepared')

    finish({
      blobId: 'abcdefghijklmnop',
      url: '/files/abcdefghijklmnop',
      mime: prepared.type,
      size: prepared.size,
      updatedAt: 1,
    })
    const uploading = wrap(() => field.uploading())
    await vi.waitFor(() => expect(uploading()).toBe(false))
    expect(field.error()).toBeNull()
    expect(field.preview()).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:prepared')
    off()
    void model
  })

  it('an upload belongs to its cat: switching cats mid-upload shows and blocks nothing there', async () => {
    let fail: () => void = () => {}
    const upload: Upload = () =>
      new Promise((resolve) => (fail = () => resolve(new StorageError({ reason: 'down' }))))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { field, model, cat, off } = setup(upload)

    await field.pick(new Blob(['png'], { type: 'image/png' }))
    await field.crop.save()
    expect(field.uploading()).toBe(true)

    cat.set(model.cat('busya'))
    expect(field.uploading()).toBe(false)
    expect(field.preview()).toBeNull()

    fail()
    const ofeliaError = wrap(() => field.error())
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce())
    // Офелия's failure is not Буся's alert...
    expect(ofeliaError()).toBeNull()

    // ...and is still Офелия's when she is chosen again.
    cat.set(model.cat('ofelia'))
    expect(field.error()).toBe(AVATAR_UPLOAD_ERROR)
    expect(field.uploading()).toBe(false)
    off()
  })

  it('a failed upload keeps the letter and shows state B', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failure = new StorageError({ reason: 'upload failed' })
    const { field, model, off } = setup(async () => failure)

    await field.pick(new Blob(['png'], { type: 'image/png' }))
    await field.crop.save()

    const error = wrap(() => field.error())
    await vi.waitFor(() => expect(error()).toBe(AVATAR_UPLOAD_ERROR))
    expect(AVATAR_UPLOAD_ERROR).toBe(
      'Не удалось загрузить фото. Попробуйте ещё раз или другой снимок.',
    )
    expect(field.uploading()).toBe(false)
    expect(model.cat('ofelia').avatarUrl()).toBeNull()
    expect(warn).toHaveBeenCalledExactlyOnceWith('[cats] the avatar upload failed', failure)
    off()
  })

  it('an image that cannot be prepared stays in the dialog with the error', async () => {
    const { field, prepareImage, off } = setup()
    prepareImage.mockResolvedValueOnce(new Error('decode failed'))

    await field.pick(new Blob(['png'], { type: 'image/png' }))
    await field.crop.save()

    expect(field.crop.open()).toBe(true)
    expect(field.crop.error()).toBe(AVATAR_UPLOAD_ERROR)
    expect(field.uploading()).toBe(false)
    expect(field.error()).toBeNull()
    off()
  })

  it('a new pick clears the last failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { field, off } = setup(async () => new StorageError({ reason: 'upload failed' }))
    await field.pick(new Blob(['png'], { type: 'image/png' }))
    await field.crop.save()
    const error = wrap(() => field.error())
    await vi.waitFor(() => expect(error()).toBe(AVATAR_UPLOAD_ERROR))

    expect(warn).toHaveBeenCalledOnce()

    await field.pick(new Blob(['png'], { type: 'image/png' }))
    expect(field.error()).toBeNull()
    off()
  })

  it('"Убрать фото" empties the slot', async () => {
    const { field, model, off } = setup()
    await field.pick(new Blob(['png'], { type: 'image/png' }))
    await field.crop.save()
    const url = wrap(() => model.cat('ofelia').avatarUrl())
    await vi.waitFor(() => expect(url()).toMatch(/^\/files\//))

    await field.remove()
    await vi.waitFor(() => expect(url()).toBeNull())
    off()
  })
})
