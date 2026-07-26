import { Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '@/domain/author'
import type { CommentView } from '@/model/ofelia-comments'

import { formatDateShort } from '../format'
import { Avatar } from './Avatar'

import styles from './CommentThread.module.css'

export type CommentThreadProps = {
  comments: CommentView[]
  onSend: (text: string) => Promise<void>
}

// TODO(task 14): CommentThread is rewritten to render EntryAuthor (including
// account avatars) properly; this is a minimal shim so the component keeps
// compiling after CommentView.author became EntryAuthor.
function authorDisplayName(author: EntryAuthor): string {
  if (author.kind === 'account') return author.name
  if (author.kind === 'person') return author.person
  return 'Неизвестно'
}

export const CommentThread = reatomMemo<CommentThreadProps>(({ comments, onSend }) => {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return

    onSend(trimmed).then(() => {
      listRef.current?.scrollTo(0, 0)
    })
    setText('')
  }

  return (
    <div className={styles.root}>
      {comments.length === 0 ? (
        <div className={styles.empty}>Пока нет комментариев</div>
      ) : (
        <ul ref={listRef} className={styles.list}>
          {[...comments].reverse().map((comment) => (
            <li key={comment.id} className={styles.item}>
              {comment.author.kind === 'person' ? (
                <Avatar person={comment.author.person} px={22} />
              ) : null}
              <div className={styles.body}>
                <div className={styles.meta}>
                  <span className={styles.author}>{authorDisplayName(comment.author)}</span>
                  <span className={styles.date}>{formatDateShort(comment.createdAt)}</span>
                </div>
                <div className={styles.text}>{comment.text}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
          inputRef.current?.focus()
        }}
      >
        <input
          ref={inputRef}
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Написать комментарий…"
          aria-label="Комментарий"
        />
        <button className={styles.send} type="submit" aria-label="Отправить">
          <Send size={15} aria-hidden />
        </button>
      </form>
    </div>
  )
}, 'CommentThread')
