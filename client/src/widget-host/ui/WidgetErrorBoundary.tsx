import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import styles from './WidgetFrame.module.css'

type Props = {
  children: ReactNode
  resetKey: number
  onError: (error: Error) => void
  onRetry: () => void
  onDelete?: () => void
}

type State = { error: Error | null }

class WidgetErrorBoundaryView extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className={styles.errorCard}>
        <span className={styles.errorTile}>
          <AlertTriangle size={22} aria-hidden />
        </span>
        <div className={styles.errorTitle}>Виджет не отвечает</div>
        <div className={styles.errorText}>Не удалось загрузить виджет</div>
        <Badge variant="outline" className={styles.errorBadge}>
          {error.name}
        </Badge>
        <div className={styles.errorActions}>
          <button className={styles.retry} aria-label="Повторить" onClick={this.props.onRetry}>
            <RotateCw size={15} aria-hidden /> Повторить
          </button>
          {this.props.onDelete && (
            <button
              className={styles.delete}
              aria-label="Удалить"
              onClick={this.props.onDelete}
            >
              Удалить
            </button>
          )}
        </div>
      </div>
    )
  }
}

export const WidgetErrorBoundary = reatomMemo<Props>(
  (props) => <WidgetErrorBoundaryView {...props} />,
  'WidgetErrorBoundary',
)
