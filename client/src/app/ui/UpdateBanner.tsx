import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

import { applyUpdate, needRefreshAtom } from '../model/pwa'

import styles from './UpdateBanner.module.css'

export const UpdateBanner = reatomMemo(() => {
  const needRefresh = needRefreshAtom()

  if (!needRefresh) return null

  return (
    <div className={styles.banner}>
      <span>Доступно обновление</span>
      <button className={styles.button} onClick={applyUpdate}>
        Обновить
      </button>
    </div>
  )
}, 'UpdateBanner')
