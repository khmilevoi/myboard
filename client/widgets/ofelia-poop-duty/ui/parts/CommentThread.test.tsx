// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommentView } from 'widgets/ofelia-poop-duty/model/ofelia-comments'

import { CommentThread } from './CommentThread'

const view = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  author: 'Карина',
  authorName: 'Карина',
  date: '10 июн',
  ipTail: '13.55',
  text: 'Привет',
  ...overrides,
})

describe('CommentThread', () => {
  it('renders each comment with its author and text', () => {
    render(
      <CommentThread
        comments={[
          view({ id: 'c1', author: 'Карина', text: 'Первый' }),
          view({ id: 'c2', author: 'Леша', text: 'Второй' }),
        ]}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByText('Первый')).toBeInTheDocument()
    expect(screen.getByText('Второй')).toBeInTheDocument()
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
  })

  it('renders an empty state when there are no comments', () => {
    render(<CommentThread comments={[]} onSend={vi.fn()} />)

    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('sends the trimmed text and clears the input when the button is clicked', () => {
    const onSend = vi.fn()
    render(<CommentThread comments={[]} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Добавить комментарий…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  Привет  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(onSend).toHaveBeenCalledWith('Привет')
    expect(input.value).toBe('')
  })

  it('sends on Enter via native form submit', () => {
    const onSend = vi.fn()
    const { container } = render(<CommentThread comments={[]} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Добавить комментарий…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Ку' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(onSend).toHaveBeenCalledWith('Ку')
    expect(input.value).toBe('')
  })

  it('does not send empty or whitespace-only text', () => {
    const onSend = vi.fn()
    render(<CommentThread comments={[]} onSend={onSend} />)

    fireEvent.change(screen.getByPlaceholderText('Добавить комментарий…'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(onSend).not.toHaveBeenCalled()
  })
})
