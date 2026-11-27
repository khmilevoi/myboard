import { wrap } from '@reatom/core'
import { useManageCats } from 'module-cats/ui/use-manage-cats'
import { useMemo, type ReactNode } from 'react'
import { type WidgetTier, useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'
import { WidgetControls, useWidgetChrome, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { catsCardStore, makeCatsCard, type CatsCard } from '../model/cats-card'
import { catsContext, type CatsContextValue } from './cats-context'
import { CompactTier } from './tiers/CompactTier'
import { FullscreenTier } from './tiers/FullscreenTier'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'

import styles from './cats.module.css'

// The card-management chrome of a state that is not ready (F16): never "Развернуть" (there is
// nothing to expand yet), but always "Удалить" on the board and "Закрыть" in fullscreen, so a card
// stuck loading or failing can still be removed or left.
function notReadyChrome(chrome: WidgetChrome): WidgetChrome {
  return { onDelete: chrome.onDelete, onClose: chrome.onClose }
}

const NotReadyFrame = reatomMemo<{ tier: WidgetTier; chrome: WidgetChrome; children: ReactNode }>(
  ({ tier, chrome, children }) => (
    <div className={styles.widget} data-tier={tier}>
      <WidgetControls placement="overlay" {...notReadyChrome(chrome)} />
      <div className={styles.center}>{children}</div>
    </div>
  ),
  'CatsNotReadyFrame',
)

// Page 10, state E: the passport's outline while the module, the registry or the cat loads.
const Loading = reatomMemo(
  () => (
    <div className={styles.loading} role="status" aria-label="Загрузка виджета «Кошки»">
      <div className={styles.loadingHead}>
        <span className={styles.bone} data-shape="avatar" />
        <span className={styles.bone} data-shape="line" />
      </div>
      <span className={styles.bone} data-shape="short" />
      <span className={styles.bone} data-shape="block" />
      <span className={styles.bone} data-shape="button" />
    </div>
  ),
  'CatsLoading',
)

// Page 10, state D. The button opens the "Все кошки" tab, in fullscreen from a board card.
const Empty = reatomMemo<{ card: CatsCard }>(({ card }) => {
  const { mode, requestFullscreen } = useWidgetContext()
  const onAdd = wrap(() => {
    card.tab.set('all')
    // The fullscreen mount is already there: asking again would stack a second history entry.
    if (mode === 'small') requestFullscreen()
  })

  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden>
        +
      </span>
      <div>
        <p className={styles.emptyTitle}>Кошек пока нет</p>
        <p className={styles.emptyText}>
          Добавьте кошку — её увидят все кошачьи карточки на борде.
        </p>
      </div>
      <button type="button" className={styles.primary} onClick={onAdd}>
        + Добавить кошку
      </button>
    </div>
  )
}, 'CatsEmpty')

/** The "Кошки" widget: one cat's passport, chosen per card. */
export const Cats = reatomMemo(() => {
  const { tier, instanceId, modules, storage, identity } = useWidgetContext()
  // Up here, before any early return: the loading, error and empty states draw the controls too.
  const { onExpand, onDelete, onClose } = useWidgetChrome()
  const chrome = useMemo<WidgetChrome>(
    () => ({ onExpand, onDelete, onClose }),
    [onExpand, onDelete, onClose],
  )
  const manage = useManageCats()
  // One card per instance, shared with the other mount of it (board tile and fullscreen).
  const card = catsCardStore(instanceId, () =>
    makeCatsCard({
      modules,
      storage: storage.instance.server,
      identity,
      name: `catsCard#${instanceId}`,
    }),
  )()
  const value = useMemo<CatsContextValue>(() => ({ card, manage }), [card, manage])

  // Read race-free and unconditionally, so the hook set stays fixed whichever branch returns.
  const status = useAtomValue(card.status)

  if (status === 'loading') {
    return (
      <NotReadyFrame tier={tier} chrome={chrome}>
        <Loading />
      </NotReadyFrame>
    )
  }

  if (status === 'error') {
    return (
      <NotReadyFrame tier={tier} chrome={chrome}>
        <div className={styles.error} role="alert">
          <p className={styles.errorText}>Не удалось загрузить виджет «Кошки»</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={wrap(() => card.handle.retry())}
          >
            Повторить
          </button>
        </div>
      </NotReadyFrame>
    )
  }

  if (status === 'empty') {
    return (
      <NotReadyFrame tier={tier} chrome={chrome}>
        <Empty card={card} />
      </NotReadyFrame>
    )
  }

  const content =
    tier === 'tiny' ? (
      <TinyTier chrome={chrome} />
    ) : tier === 'compact' ? (
      <CompactTier chrome={chrome} />
    ) : tier === 'standard' ? (
      <StandardTier chrome={chrome} />
    ) : (
      <FullscreenTier chrome={chrome} />
    )

  return (
    <div className={styles.widget} data-tier={tier}>
      <catsContext.Provider value={value}>{content}</catsContext.Provider>
    </div>
  )
}, 'Cats')
