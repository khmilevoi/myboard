import { Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '@/domain/author'
import { ofeliaEventSchemas } from '@/domain/events'
import { DUTY_TIME_ZONE, plainDateIn } from '@/domain/roster'
import type { CommentView } from '@/model/ofelia-comments'

import { formatDayMonth, formatTimeOfDay } from '../history-format'
import { MemberAvatar } from './MemberAvatar'

import styles from './CommentThread.module.css'

// Sourced from the same event payload schema the server validates against —
// never hardcode a second copy of the limit that could drift from it (F6b).
const COMMENT_MAX_LENGTH = ofeliaEventSchemas.comment.payload.shape.text.maxLength ?? undefined

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
          {/* `автор неизвестен` is a placeholder, not a name, so it never gets
              the emphasis a real name carries — same split as the history
              signature row. */}
          <span className={styles.author} data-unknown={comment.author.kind === 'unknown'}>
            {authorName(comment.author)}
          </span>
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
  /** True only when `comments` has never resolved for the viewed week — it
   *  would otherwise show a DIFFERENT week's rows, so the failure state takes
   *  priority over rendering them (F14). */
  failed?: boolean
  /** True when the viewed week's read has failed but `comments` already holds
   *  that week's own rows (a transient hiccup) — show a banner without
   *  hiding them. Ignored when `failed` is also true. */
  warning?: boolean
  /** The signed-in account, or null while the members directory is still loading. */
  viewer: EntryAuthor | null
  today: string | null
  onSend: (text: string) => Promise<void>
}

export const CommentThread = reatomMemo<CommentThreadProps>(
  ({ comments, failed = false, warning = false, viewer, today, onSend }) => {
    const [text, setText] = useState('')
    const [sendError, setSendError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLUListElement>(null)

    const submit = () => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return

      setSendError(null)
      onSend(trimmed)
        .then(() => {
          // Clearing only on success is the whole fix: `text` is otherwise
          // left exactly as the reader typed it, so a failure never
          // destroys a draft — there is nothing to "restore".
          setText('')
          listRef.current?.scrollTo(0, 0)
        })
        .catch(() => {
          setSendError('Не удалось отправить комментарий')
        })
    }

    return (
      <div className={styles.root}>
        {/* A transient failure on an already-loaded week keeps the rows on
            screen — only a banner marks it, never a wholesale swap for the
            "failed" box below (that box is reserved for `failed`, where
            `comments` may be a different week's rows entirely). */}
        {warning && !failed ? (
          <div className={styles.loadWarning} role="alert">
            Не удалось обновить комментарии
          </div>
        ) : null}
        {failed ? (
          <div className={styles.empty} role="alert">
            Не удалось загрузить комментарии
          </div>
        ) : comments.length === 0 ? (
          <div className={styles.empty}>Пока нет комментариев</div>
        ) : (
          <ul ref={listRef} className={styles.list}>
            {[...comments].reverse().map((comment) => (
              <Row key={comment.id} comment={comment} today={today} />
            ))}
          </ul>
        )}

        {sendError ? (
          <div className={styles.sendError} role="alert">
            {sendError}
          </div>
        ) : null}

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
            maxLength={COMMENT_MAX_LENGTH}
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
