import { Board } from '../board/Board'
import { FullscreenOverlay } from '../widget-host/FullscreenOverlay'
import styles from './App.module.css'
import { ErrorBoundary } from './ErrorBoundary'
import { Header } from './Header'

export function App() {
  return (
    <ErrorBoundary>
      <div className={styles.app}>
        <Header />
        <main className={styles.main}>
          <Board />
        </main>
        <FullscreenOverlay />
      </div>
    </ErrorBoundary>
  )
}
