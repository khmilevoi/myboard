import { Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '@/domain/author'
import { DUTY_TIME_ZONE, plainDateIn } from '@/domain/roster'
import type { CommentView } from '@/model/ofelia-comments'

import { formatDayMonth, formatTimeOfDay } from '../history-format'
import { MemberAvatar } from './MemberAvatar'

import styles from './CommentThread.module.css'

function authorName(author: EntryAuthor): string {
  if (author.kind === 'account') return author.name
  if (author.kind === 'person') return author.person
  return 'автор неизвестен'
}

// Same-day comments show only a time; anything older is prefixed with its date.
// `today` is a prop rather than `Temporal.Now` so the component stays pure and
// testable, exactly like HistoryList.
function formatCommentStamp(createdAt: number, todayIso: string | null): string {
  const time = formatTimeOfDay(createdAt)
  const day = plainDateIn(DUTY_TIME_ZONE, createdAt).toString()
  return day === todayIso ? time : `${formatDayMonth(day)}, ${time}`
}

const Row = reatomMemo<{ comment: CommentView; today: string | null }>(
  ({ comment, today }) => (
    <li className={styles.item}>
      <MemberAvatar author={comment.author} isViewer={comment.isViewerComment} px={22} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.author}>{authorName(comment.author)}</span>
          {comment.author.kind === 'person' ? (
            <span className={styles.legacy}>без аккаунта</span>
          ) : null}
          <span className={styles.date}>{formatCommentStamp(comment.createdAt, today)}</span>
        </div>
        <div className={styles.text}>{comment.text}</div>
      </div>
    </li>
  ),
  'CommentRow',
)

export type CommentThreadProps = {
  comments: CommentView[]
  /** The signed-in account, or null while the members directory is still loading. */
  viewer: EntryAuthor | null
  today: string | null
  onSend: (text: string) => Promise<void>
}

export const CommentThread = reatomMemo<CommentThreadProps>(
  ({ comments, viewer, today, onSend }) => {
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
              <Row key={comment.id} comment={comment} today={today} />
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
          {/* Every other avatar in this widget sits next to the author's name in
              the text; this one does not, so it carries its own accessible name.
              `role="img"` makes the circle's initial presentational, so assistive
              tech hears the label instead of a bare letter. It stays invisible —
              the spec has no "signed in as" affordance in the UI. */}
          {viewer ? (
            <span
              className={styles.viewer}
              role="img"
              aria-label={`Вы вошли как ${authorName(viewer)}`}
            >
              <MemberAvatar author={viewer} isViewer px={22} />
            </span>
          ) : (
            <span className={styles.viewerPending} aria-hidden />
          )}
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
  },
  'CommentThread',
)
