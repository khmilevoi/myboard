import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { UserAvatar } from 'widget-sdk/ui/UserAvatar'

import type { CatCareModel } from '../model/cat-care'

import styles from './cat-care.module.css'

export const ViewerBadge = reatomMemo<{ model: CatCareModel; compact?: boolean }>(
  ({ model, compact }) => {
    const viewer = model.viewer()
    return (
      <div
        className={styles.viewer}
        data-testid="cat-care-viewer"
        title={viewer ? `Вы вошли как ${viewer.name}` : 'Пользователь пока не определён'}
      >
        <UserAvatar
          name={viewer?.name}
          avatarUrl={viewer?.avatarUrl}
          identityKey={viewer?.accountId}
          px={compact ? 22 : 28}
          decorative
        />
        <span className={styles.viewerName}>
          <small>{viewer ? 'Вы' : 'Аккаунт'}</small>
          <strong>{viewer?.name ?? 'Не определён'}</strong>
        </span>
      </div>
    )
  },
  'CatCare.ViewerBadge',
)

export const AuthorLine = reatomMemo<{
  model: CatCareModel
  kind: 'food' | 'water' | 'weight'
  recordId: string
}>(({ model, kind, recordId }) => {
  const author = model.recordAuthors()[kind].get(recordId)
  const isViewer = !!author && author.accountId === model.viewer()?.accountId
  return (
    <span
      className={styles.authorLine}
      data-testid="cat-care-record-author"
      data-viewer={isViewer || undefined}
    >
      <UserAvatar
        name={author?.name}
        avatarUrl={author?.avatarUrl}
        identityKey={author?.accountId}
        px={18}
        decorative
      />
      <span>
        {author?.name ?? 'Автор неизвестен'}
        {isViewer ? ' · вы' : ''}
      </span>
    </span>
  )
}, 'CatCare.AuthorLine')
