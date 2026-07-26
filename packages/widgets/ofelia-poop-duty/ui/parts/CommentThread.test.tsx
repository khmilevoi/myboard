// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommentView } from '@/model/ofelia-comments'

import { CommentThread } from './CommentThread'

// TODO(task 14): the fixture still hand-builds `createdAt` timestamps whose
// `formatDateShort` output matches the old literal `date` strings; Task 14's
// rewrite can pick a clearer fixture shape.
const dateAt = (day: number) => new Date(2026, 5, day, 12, 0, 0).getTime()

const view = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  author: { kind: 'person', person: 'Карина' },
  createdAt: dateAt(10),
  isViewerComment: false,
  text: 'Привет',
  ...overrides,
})

describe('CommentThread', () => {
  it('renders each comment with avatar, author name, date, and text', () => {
    render(
      <CommentThread
        comments={[
          view({
            id: 'c1',
            author: { kind: 'person', person: 'Карина' },
            createdAt: dateAt(10),
            text: 'Первый',
          }),
          view({
            id: 'c2',
            author: { kind: 'person', person: 'Леша' },
            createdAt: dateAt(11),
            text: 'Второй',
          }),
        ]}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByText('Первый')).toBeInTheDocument()
    expect(screen.getByText('Второй')).toBeInTheDocument()
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('10 июн')).toBeInTheDocument()
    expect(screen.getByText('11 июн')).toBeInTheDocument()
  })

  it('renders an empty state when there are no comments', () => {
    render(<CommentThread comments={[]} onSend={vi.fn()} />)
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('sends the trimmed text and clears the input when the send icon is clicked', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<CommentThread comments={[]} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Написать комментарий…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  Привет  ' } })
    fireEvent.click(screen.getByLabelText('Отправить'))

    expect(onSend).toHaveBeenCalledWith('Привет')
    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('sends on Enter via native form submit', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<CommentThread comments={[]} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Написать комментарий…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Ку' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(onSend).toHaveBeenCalledWith('Ку')
    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('does not send empty or whitespace-only text', () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<CommentThread comments={[]} onSend={onSend} />)

    fireEvent.change(screen.getByPlaceholderText('Написать комментарий…'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByLabelText('Отправить'))

    expect(onSend).not.toHaveBeenCalled()
  })

  it('renders an icon send button', () => {
    render(<CommentThread comments={[]} onSend={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByLabelText('Отправить')).toBeInTheDocument()
  })
})
