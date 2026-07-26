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

  it('labels an unknown author', () => {
    renderThread({ comments: [comment({ author: { kind: 'unknown' } })] })

    expect(screen.getByText('автор неизвестен')).toBeInTheDocument()
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

  it('renders an empty state', () => {
    renderThread()

    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  // The composer circle is the one avatar in this widget with no adjacent name
  // in the text, so it carries its own accessible name instead of announcing a
  // bare initial. It stays invisible: the spec has no "signed in as" affordance.
  it('names the composer avatar for assistive tech', () => {
    renderThread({ viewer: { kind: 'account', accountId: 'a1', name: 'Карина' } })

    expect(screen.getByRole('img', { name: 'Вы вошли как Карина' })).toBeInTheDocument()
  })
})
