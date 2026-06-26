import { Board } from '@/board/ui/Board'
import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { FullscreenOverlay } from '@/widget-host/ui/FullscreenOverlay'

import { ErrorBoundary } from './ErrorBoundary'
import { Header } from './Header'
import { UpdateBanner } from './UpdateBanner'

import styles from './App.module.css'

export const App = reatomMemo(() => {
  return (
    <ErrorBoundary>
      <div className={styles.app}>
        <Header />
        <main className={styles.main}>
          <Board />
        </main>
        <FullscreenOverlay />
        <UpdateBanner />
      </div>
    </ErrorBoundary>
  )
}, 'App')
