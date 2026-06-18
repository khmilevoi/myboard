import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import styles from './WidgetFrame.module.css'

type Props = {
  children: ReactNode
  resetKey: number
  onError: (error: Error) => void
  onRetry: () => void
}

type State = { error: Error | null }

export class WidgetErrorBoundary extends Component<Props, State> {
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
    if (!this.state.error) return this.props.children

    return (
      <div className={styles.errorCard}>
        <AlertTriangle className={styles.errorIcon} size={22} aria-hidden />
        <div>Widget failed to load</div>
        <button className={styles.retry} aria-label="Retry" onClick={this.props.onRetry}>
          <RotateCw size={15} aria-hidden /> Retry
        </button>
      </div>
    )
  }
}
