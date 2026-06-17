import { LayoutGrid } from 'lucide-react'
import { AddWidgetMenu } from '../board/AddWidgetMenu'
import { ThemeToggle } from './ThemeToggle'
import styles from './Header.module.css'

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <LayoutGrid size={18} strokeWidth={2.2} aria-hidden />
        </span>
        <span className={styles.name}>myboard</span>
      </div>
      <div className={styles.actions}>
        <ThemeToggle />
        <AddWidgetMenu />
      </div>
    </header>
  )
}
