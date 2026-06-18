import { AddWidgetMenu } from '../../board/ui/AddWidgetMenu'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { ThemeToggle } from '../../theme/ui/ThemeToggle'
import styles from './Header.module.css'

export const Header = reatomMemo(() => {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <span className={styles.logoMuted}>my</span>
          <span className={styles.logoStrong}>board</span>
        </span>
      </div>
      <div className={styles.actions}>
        <ThemeToggle />
        <AddWidgetMenu />
      </div>
    </header>
  )
}, 'Header')
