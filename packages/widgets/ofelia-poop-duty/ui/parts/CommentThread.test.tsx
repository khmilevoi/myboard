// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommentView } from '@/model/ofelia-comments'

import { CommentThread } from './CommentThread'

const comment = (o: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  text: 'привет',
  author: { kind: 'account', accountId: 'a1', name: 'Карина' },
  createdAt: Date.UTC(2026, 5, 16, 19, 44),
  isViewerComment: false,
  ...o,
})

const TODAY = '2026-06-16'

const renderThread = (props: Partial<Parameters<typeof CommentThread>[0]> = {}) =>
  render(<CommentThread comments={[]} viewer={null} today={TODAY} onSend={vi.fn()} {...props} />)

describe('CommentThread', () => {
  it('renders the author, the time and the text', () => {
    renderThread({ comments: [comment()] })

    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('Карина')).toHaveAttribute('data-unknown', 'false')
    expect(screen.getByText('21:44')).toBeInTheDocument()
    expect(screen.getByText('привет')).toBeInTheDocument()
  })

  it('prefixes older comments with their date', () => {
    renderThread({ comments: [comment({ createdAt: Date.UTC(2026, 5, 14, 19, 44) })] })

    expect(screen.getByText('14 июня, 21:44')).toBeInTheDocument()
  })

  it('labels a legacy author', () => {
    renderThread({ comments: [comment({ author: { kind: 'person', person: 'Леша' } })] })

    expect(screen.getByText('без аккаунта')).toBeInTheDocument()
  })

  // The mock sets `автор неизвестен` in the muted, non-bold treatment a real name
  // never gets, so the placeholder never reads as somebody's name.
  it('labels an unknown author', () => {
    renderThread({ comments: [comment({ author: { kind: 'unknown' } })] })

    expect(screen.getByText('автор неизвестен')).toBeInTheDocument()
    expect(screen.getByText('автор неизвестен')).toHaveAttribute('data-unknown', 'true')
  })

  it('never renders an ip', () => {
    const { container } = renderThread({ comments: [comment()] })

    expect(container.textContent).not.toMatch(/\d+\.\d+\.\d+/)
  })

  it('sends the trimmed text and clears the field', async () => {
    const onSend = vi.fn(async () => {})
    renderThread({ onSend })

    const input = screen.getByLabelText('Комментарий')
    fireEvent.change(input, { target: { value: '  тест  ' } })
    fireEvent.click(screen.getByLabelText('Отправить'))

    expect(onSend).toHaveBeenCalledWith('тест')
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('sends on Enter via native form submit', async () => {
    const onSend = vi.fn(async () => {})
    const { container } = renderThread({ onSend })

    const input = screen.getByLabelText('Комментарий')
    fireEvent.change(input, { target: { value: 'Ку' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(onSend).toHaveBeenCalledWith('Ку')
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('does not send empty or whitespace-only text', () => {
    const onSend = vi.fn(async () => {})
    renderThread({ onSend })

    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: '   ' } })
    fireEvent.click(screen.getByLabelText('Отправить'))

    expect(onSend).not.toHaveBeenCalled()
  })

  it('renders an empty state', () => {
    renderThread()

    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  // F14: `comments` may still hold a previous week's rows when the current
  // week's read has failed — `failed` must win over rendering them.
  it('shows a failure state instead of a possibly stale thread', () => {
    renderThread({ comments: [comment()], failed: true })

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить комментарии')
    expect(screen.queryByText('привет')).not.toBeInTheDocument()
  })

  // MEDIUM (F14 follow-up): a transient failure on an already-loaded week
  // must not blank rows that genuinely belong to it — only a banner marks
  // the failure, the thread stays visible.
  it('shows a warning banner without hiding an already-loaded thread', () => {
    renderThread({ comments: [comment()], warning: true })

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось обновить комментарии')
    expect(screen.getByText('привет')).toBeInTheDocument()
  })

  it('prefers the failed state over the warning when both are set', () => {
    renderThread({ comments: [comment()], failed: true, warning: true })

    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Не удалось загрузить комментарии')
    expect(screen.queryByText('привет')).not.toBeInTheDocument()
  })

  describe('send failure (F6b)', () => {
    it('keeps the draft and surfaces an error instead of discarding the text', async () => {
      const onSend = vi.fn(async () => {
        throw new Error('network down')
      })
      renderThread({ onSend })

      const input = screen.getByLabelText('Комментарий')
      fireEvent.change(input, { target: { value: '  черновик  ' } })
      fireEvent.click(screen.getByLabelText('Отправить'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Не удалось отправить комментарий')
      })
      // Before the fix `setText('')` ran unconditionally the moment the
      // handler fired, regardless of the outcome — the draft was gone before
      // `onSend` even settled.
      expect(input).toHaveValue('  черновик  ')
    })

    it('clears a previous send error on the next successful send', async () => {
      const onSend = vi
        .fn<(text: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(undefined)
      renderThread({ onSend })

      const input = screen.getByLabelText('Комментарий')
      fireEvent.change(input, { target: { value: 'раз' } })
      fireEvent.click(screen.getByLabelText('Отправить'))
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

      fireEvent.click(screen.getByLabelText('Отправить'))
      await waitFor(() => expect(input).toHaveValue(''))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  // The server payload schema caps comment text at 2000 characters; a longer
  // draft is a guaranteed 422 the reader would otherwise experience as the
  // composer silently eating their message.
  it('caps the input to the server-enforced comment length', () => {
    renderThread()

    expect(screen.getByLabelText('Комментарий')).toHaveAttribute('maxlength', '2000')
  })

  // The composer circle is the one avatar in this widget with no adjacent name
  // in the text, so it carries its own accessible name instead of announcing a
  // bare initial. It stays invisible: the spec has no "signed in as" affordance.
  it('names the composer avatar for assistive tech', () => {
    renderThread({ viewer: { kind: 'account', accountId: 'a1', name: 'Карина' } })

    expect(screen.getByRole('img', { name: 'Вы вошли как Карина' })).toBeInTheDocument()
  })
})
