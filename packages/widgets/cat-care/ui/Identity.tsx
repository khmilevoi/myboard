import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { UserAvatar } from 'widget-sdk/ui/UserAvatar'

import type { CatCareModel } from '../model/cat-care'

import styles from './cat-care.module.css'

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
