import { context } from '@reatom/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { makeAvatarCropModel } from 'widget-sdk/files/avatar-crop-model'
import { AvatarCropDialog } from 'widget-sdk/ui/AvatarCropDialog'

import { AvatarApiError, AvatarHttpError, describeAvatarError } from '../model/avatar-http'
import { AccountAvatarPreviews } from './AccountAvatarPreviews'

// Reset BEFORE each test -- AccountMenu.test.tsx's documented convention for reatomMemo trees.
beforeEach(() => context.reset())

/** The crop dialog exactly as AccountMenu mounts it, with the account's copy and previews. */
async function openAccountCrop(upload: () => Promise<Error | null> = async () => null) {
  const model = makeAvatarCropModel({
    upload,
    describeError: describeAvatarError,
    readImageSize: async () => ({ width: 4000, height: 3000 }),
    createObjectUrl: () => 'blob:photo',
    revokeObjectUrl: () => {},
  })
  render(
    <AvatarCropDialog
      model={model}
      title="Обрезать фото"
      hint="Перетащите фото, чтобы выбрать, что попадёт в круг."
      previewTitle="Так фото увидят другие"
      previews={(renderPreview) => (
        <AccountAvatarPreviews renderPreview={renderPreview} firstName="Анна" />
      )}
      onPickAnother={() => {}}
    />,
  )
  await act(() => model.openFile(new Blob(['jpeg'])))
  return screen.findByTestId('avatar-crop-dialog')
}

describe('the account crop dialog', () => {
  it('(k) previews the photo in the menu, the header and a widget history line', async () => {
    const dialog = await openAccountCrop()

    expect(within(dialog).getByText('Так фото увидят другие')).toBeInTheDocument()
    expect(within(dialog).getByText('Меню')).toBeInTheDocument()
    expect(within(dialog).getByText('Хедер')).toBeInTheDocument()
    expect(within(dialog).getByText('История виджета')).toBeInTheDocument()
    expect(within(dialog).getByText('Анна отметил(а) уборку')).toBeInTheDocument()
    for (const [id, size] of [
      ['avatar-crop-preview-menu', 44],
      ['avatar-crop-preview-header', 36],
      ['avatar-crop-preview-history', 18],
    ] as const) {
      // Zoom 1 on a 4:3 photo: the preview circle shows the full height.
      expect(screen.getByTestId(id)).toHaveStyle({ height: `${size}px` })
    }
  })

  it('(m) words a transport failure as the account copy', async () => {
    const dialog = await openAccountCrop(async () => new AvatarHttpError({ reason: 'transport' }))

    fireEvent.click(within(dialog).getByTestId('avatar-crop-save'))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить фото. Проверьте подключение и попробуйте ещё раз.',
    )
  })

  it('maps a rejected size to its own copy', async () => {
    const dialog = await openAccountCrop(
      async () => new AvatarApiError({ status: '413', code: 'file_too_large' }),
    )

    fireEvent.click(within(dialog).getByTestId('avatar-crop-save'))

    expect(await within(dialog).findByTestId('avatar-crop-error')).toHaveTextContent(
      'Фото слишком большое. Выберите другое.',
    )
  })
})
