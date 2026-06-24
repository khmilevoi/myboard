import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './MobileTabs.module.css'

export type MobileTabsProps = {
  tab: 'history' | 'comments'
  onChange: (tab: 'history' | 'comments') => void
  className?: string
}

export const MobileTabs = reatomMemo<MobileTabsProps>(({ tab, onChange, className }) => {
  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <Tabs
        className={styles.tabs}
        value={tab}
        onValueChange={(value) => onChange(value as MobileTabsProps['tab'])}
      >
        <TabsList className={styles.list}>
          <TabsTrigger className={styles.trigger} value="history">
            История
          </TabsTrigger>
          <TabsTrigger className={styles.trigger} value="comments">
            Комментарии
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}, 'MobileTabs')
