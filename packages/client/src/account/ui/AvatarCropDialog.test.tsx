import { context } from '@reatom/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAvatarCropModel } from '../model/avatar-crop-model'
import { AvatarApiError, AvatarHttpError } from '../model/avatar-http'
import { AvatarCropDialog } from './AvatarCropDialog'

// Reset BEFORE each test -- AccountMenu.test.tsx's documented convention for reatomMemo trees.
beforeEach(() => context.reset())

const LANDSCAPE = { width: 4000, height: 3000 }

function setup(
  options: {
    size?: { width: number; height: number } | Error
    upload?: () => Promise<Error | null>
  } = {},
) {
  const upload = vi.fn(options.upload ?? (async () => null))
  const revokeObjectUrl = vi.fn()
  const onPickAnother = vi.fn()
  const model = makeAvatarCropModel({
    upload,
    readImageSize: async () => options.size ?? LANDSCAPE,
    createObjectUrl: () => 'blob:photo',
    revokeObjectUrl,
  })
  render(<AvatarCropDialog model={model} firstName="Анна" onPickAnother={onPickAnother} />)
  return { model, upload, revokeObjectUrl, onPickAnother }
}

async function openWith(model: ReturnType<typeof setup>['model'], file = new Blob(['jpeg'])) {
  await act(() => model.openFile(file))
  return screen.findByTestId('avatar-crop-dialog')
}

function pointer(pointerId: number, clientX: number, clientY: number) {
  return { pointerId, clientX, clientY, button: 0, pointerType: 'touch' }
}

describe('AvatarCropDialog', () => {
  it('(k) shows the photo under the circle, the zoom slider and the three live previews', async () => {
    const { model } = setup()
    const dialog = await openWith(model)

    expect(within(dialog).getByRole('heading', { name: 'Обрезать фото' })).toBeInTheDocument()
    expect(
      within(dialog).getByText('Перетащите фото, чтобы выбрать, что попадёт в круг.'),
    ).toBeInTheDocument()
    const stage = within(dialog).getByRole('group', { name: 'Область обрезки: круг поверх фото' })
    expect(stage).toHaveAttribute('tabindex', '0')
    expect(within(stage).getByTestId('avatar-crop-image')).toHaveAttribute('src', 'blob:photo')
    expect(within(dialog).getByRole('slider', { name: 'Масштаб' })).toHaveValue('1')
    expect(within(dialog).getByText('Так фото увидят другие')).toBeInTheDocument()
    expect(within(dialog).getByText('Анна отметил(а) уборку')).toBeInTheDocument()
    for (const [id, size] of [
      ['avatar-crop-preview-menu', 44],
      ['avatar-crop-preview-header', 36],
      ['avatar-crop-preview-history', 18],
    ] as const) {
      // Zoom 1 on a 4:3 photo: the preview circle shows the full height.
      expect(screen.getByTestId(id)).toHaveStyle({ height: `${size}px` })
    }
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeEnabled()
    expect(within(dialog).getByTestId('avatar-crop-save')).toHaveTextContent('Сохранить')
  })

  it('zooms from the slider and the previews follow', async () => {
    const { model } = setup()
    const dialog = await openWith(model)

    fireEvent.change(within(dialog).getByRole('slider', { name: 'Масштаб' }), {
      target: { value: '2' },
    })

    expect(model.zoom()).toBe(2)
    await waitFor(() =>
      expect(screen.getByTestId('avatar-crop-preview-menu')).toHaveStyle({ height: '88px' }),
    )
  })

  it('pans with a pointer drag', async () => {
    const { model } = setup()
    const stage = within(await openWith(model)).getByTestId('avatar-crop-stage')

    fireEvent.pointerDown(stage, pointer(1, 100, 100))
    fireEvent.pointerMove(stage, pointer(1, 78, 100))
    fireEvent.pointerUp(stage, pointer(1, 78, 100))
    // Dragging left by 22 px moves the selection right by 22 × 3000/220 source px.
    expect(model.crop()?.x).toBeCloseTo(800)

    // Moves without a pressed pointer do nothing.
    fireEvent.pointerMove(stage, pointer(1, 0, 100))
    expect(model.crop()?.x).toBeCloseTo(800)
  })

  it('zooms with the wheel and with a two-finger pinch', async () => {
    const { model } = setup()
    const stage = within(await openWith(model)).getByTestId('avatar-crop-stage')

    fireEvent.wheel(stage, { deltaY: -200, clientX: 0, clientY: 0 })
    expect(model.zoom()).toBeCloseTo(Math.exp(0.4))

    model.zoomTo(1)
    fireEvent.pointerDown(stage, pointer(1, 100, 100))
    fireEvent.pointerDown(stage, pointer(2, 200, 100))
    fireEvent.pointerMove(stage, pointer(2, 300, 100))
    expect(model.zoom()).toBeCloseTo(2)
    fireEvent.pointerUp(stage, pointer(2, 300, 100))
    fireEvent.pointerUp(stage, pointer(1, 100, 100))
  })

  it('moves with the arrow keys, further with Shift, and zooms with plus and minus', async () => {
    const { model } = setup()
    const stage = within(await openWith(model)).getByTestId('avatar-crop-stage')
    model.zoomTo(2)
    const start = model.crop()!.x

    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    const small = model.crop()!.x - start
    fireEvent.keyDown(stage, { key: 'ArrowLeft', shiftKey: true })
    expect(small).toBeGreaterThan(0)
    expect(model.crop()!.x - start - small).toBeCloseTo(small * 5)

    fireEvent.keyDown(stage, { key: '+' })
    expect(model.zoom()).toBeCloseTo(2.1)
    fireEvent.keyDown(stage, { key: '-' })
    expect(model.zoom()).toBeCloseTo(2)
  })

  it('(l) locks everything while saving, then closes on success', async () => {
    let finish: (value: Error | null) => void = () => {}
    const { model, upload, revokeObjectUrl } = setup({
      upload: () => new Promise((resolve) => (finish = resolve)),
    })
    const dialog = await openWith(model)

    fireEvent.click(within(dialog).getByTestId('avatar-crop-save'))

    const save = within(dialog).getByTestId('avatar-crop-save')
    await waitFor(() => expect(save).toBeDisabled())
    expect(save).toHaveTextContent('Сохраняем…')
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toBeDisabled()
    expect(within(dialog).getByRole('slider', { name: 'Масштаб' })).toBeDisabled()
    expect(
      within(dialog).getByRole('group', {
        name: 'Область обрезки заблокирована во время сохранения',
      }),
    ).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(model.open()).toBe(true)
    expect(upload).toHaveBeenCalledWith(expect.any(Blob), { x: 500, y: 0, size: 3000 })

    await act(async () => finish(null))

    await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).toBeNull())
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo')
  })

  it('(m) keeps the dialog and the selection with the error above the buttons', async () => {
    const { model } = setup({
      upload: async () => new AvatarHttpError({ reason: 'transport' }),
    })
    const dialog = await openWith(model)
    model.zoomTo(2)

    fireEvent.click(within(dialog).getByTestId('avatar-crop-save'))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить фото. Проверьте подключение и попробуйте ещё раз.',
    )
    expect(within(dialog).getByTestId('avatar-crop-stage')).toBeInTheDocument()
    expect(within(dialog).getByTestId('avatar-crop-save')).toBeEnabled()
    expect(model.zoom()).toBe(2)
  })

  it('maps a rejected size to its own copy', async () => {
    const { model } = setup({
      upload: async () => new AvatarApiError({ status: '413', code: 'file_too_large' }),
    })
    const dialog = await openWith(model)

    fireEvent.click(within(dialog).getByTestId('avatar-crop-save'))

    expect(await within(dialog).findByTestId('avatar-crop-error')).toHaveTextContent(
      'Фото слишком большое. Выберите другое.',
    )
  })

  it('opens an unreadable file without a stage and offers another file instead of saving', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { model, onPickAnother } = setup({ size: new Error('decode') })
    const dialog = await openWith(model)

    expect(within(dialog).getByTestId('avatar-crop-error')).toHaveTextContent(
      'Не получилось прочитать файл. Выберите фото в JPEG, PNG или WebP.',
    )
    expect(within(dialog).queryByTestId('avatar-crop-stage')).toBeNull()
    expect(within(dialog).queryByRole('slider')).toBeNull()
    expect(within(dialog).queryByTestId('avatar-crop-save')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Выбрать другой файл' }))
    expect(onPickAnother).toHaveBeenCalledTimes(1)
  })

  it('closes on Отмена and releases the preview URL', async () => {
    const { model, revokeObjectUrl, upload } = setup()
    const dialog = await openWith(model)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))

    await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).toBeNull())
    expect(model.open()).toBe(false)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo')
    expect(upload).not.toHaveBeenCalled()
  })
})
