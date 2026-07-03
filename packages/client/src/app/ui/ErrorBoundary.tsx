import { Component, type ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

type Props = { children: ReactNode }
type State = { error: Error | null }

class ErrorBoundaryView extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Host render error:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--danger)' }}>
          <h2>Something went wrong</h2>
          <pre>{this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

export const ErrorBoundary = reatomMemo<Props>(
  ({ children }) => <ErrorBoundaryView>{children}</ErrorBoundaryView>,
  'ErrorBoundary',
)
