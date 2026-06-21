import { AlertTriangle, RotateCw } from 'lucide-react'
import type { ErrorInfo, ReactNode } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'

import { Badge } from '@/components/ui/badge'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './WidgetFrame.module.css'

type Props = {
  children: ReactNode
  resetKey: number
  onError: (error: Error) => void
  onRetry: () => void
  onDelete?: () => void
}

function WidgetErrorFallback({
  error,
  onRetry,
  onDelete,
}: FallbackProps & Pick<Props, 'onRetry' | 'onDelete'>) {
  const name = error instanceof Error ? error.name : 'Error'

  return (
    <div className={styles.errorCard}>
      <span className={styles.errorTile}>
        <AlertTriangle size={22} aria-hidden />
      </span>
      <div className={styles.errorTitle}>Виджет не отвечает</div>
      <div className={styles.errorText}>Не удалось загрузить виджет</div>
      <Badge variant="outline" className={styles.errorBadge}>
        {name}
      </Badge>
      <div className={styles.errorActions}>
        <button className={styles.retry} aria-label="Повторить" onClick={onRetry}>
          <RotateCw size={15} aria-hidden /> Повторить
        </button>
        {onDelete && (
          <button className={styles.delete} aria-label="Удалить" onClick={onDelete}>
            Удалить
          </button>
        )}
      </div>
    </div>
  )
}

export const WidgetErrorBoundary = reatomMemo<Props>(
  ({ children, resetKey, onError, onRetry, onDelete }) => (
    <ErrorBoundary
      resetKeys={[resetKey]}
      onError={(error: unknown, _info: ErrorInfo) => onError(error as Error)}
      fallbackRender={(props) => (
        <WidgetErrorFallback {...props} onRetry={onRetry} onDelete={onDelete} />
      )}
    >
      {children}
    </ErrorBoundary>
  ),
  'WidgetErrorBoundary',
)
