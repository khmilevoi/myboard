import { useState } from 'react'
import type { CommentView } from 'widgets/ofelia-poop-duty/model/ofelia-comments'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './CommentThread.module.css'

export type CommentThreadProps = {
  comments: CommentView[]
  onSend: (text: string) => void
}

export const CommentThread = reatomMemo<CommentThreadProps>(({ comments, onSend }) => {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return

    onSend(trimmed)
    setText('')
  }

  return (
    <div className={styles.root}>
      {comments.length === 0 ? (
        <div className={styles.empty}>Пока нет комментариев</div>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.item}>
              <span className={styles.author}>{comment.author}</span>
              <span className={styles.text}>{comment.text}</span>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Добавить комментарий…"
          aria-label="Комментарий"
        />
        <button className={styles.send} type="submit">
          Отправить
        </button>
      </form>
    </div>
  )
}, 'CommentThread')
