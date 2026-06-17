import { LayoutGrid } from 'lucide-react'
import styles from './EmptyState.module.css'

export function EmptyState() {
  return (
    <div className={styles.empty}>
      <span className={styles.icon}>
        <LayoutGrid size={32} strokeWidth={1.6} aria-hidden />
      </span>
      <h2 className={styles.title}>No widgets yet</h2>
      <p className={styles.hint}>Use "Add widget" in the top bar to place your first widget.</p>
    </div>
  )
}
