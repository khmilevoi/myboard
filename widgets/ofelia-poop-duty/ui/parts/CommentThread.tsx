import type { CommentView } from '@widgets/ofelia-poop-duty/model/ofelia-comments'
import { Send } from 'lucide-react'
import { useRef, useState } from 'react'

import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

import { Avatar } from './Avatar'

import styles from './CommentThread.module.css'

export type CommentThreadProps = {
  comments: CommentView[]
  onSend: (text: string) => Promise<void>
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
              <Avatar person={comment.author} px={22} />
              <div className={styles.body}>
                <div className={styles.meta}>
                  <span className={styles.author}>{comment.authorName}</span>
                  <span className={styles.date}>{comment.date}</span>
                  {comment.ipTail ? <span className={styles.ip}>{comment.ipTail}</span> : null}
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
