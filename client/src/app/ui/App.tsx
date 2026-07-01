import { lazy, Suspense } from 'react'

import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'
import { FullscreenOverlay } from '@/widget-host/ui/FullscreenOverlay'

import { ErrorBoundary } from './ErrorBoundary'
import { Header } from './Header'
import { UpdateBanner } from './UpdateBanner'

import styles from './App.module.css'

const Board = lazy(() => import('@/board/ui/Board').then((mod) => ({ default: mod.Board })))

export const App = reatomMemo(() => {
  return (
    <ErrorBoundary>
      <div className={styles.app}>
        <Header />
        <main className={styles.main}>
          <Suspense fallback={<div className={styles.boardFallback} />}>
            <Board />
          </Suspense>
        </main>
        <FullscreenOverlay />
        <UpdateBanner />
      </div>
    </ErrorBoundary>
  )
}, 'App')
