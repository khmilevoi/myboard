import { wrap } from '@reatom/core'
import { Cat } from 'lucide-react'
import { catsModule, type LitterModel } from 'module-cats'
import { makeLitterChoice } from 'module-cats/card-choice'
import { CatCardHeader } from 'module-cats/ui/CatCardHeader'
import { useManageCats } from 'module-cats/ui/use-manage-cats'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { type WidgetTier, useWidgetContext } from 'widget-runtime'
import { reatomModule } from 'widget-sdk/modules/reatom-module'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'
import { WidgetControls, useWidgetChrome, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { ofeliaCommentsModel } from '../model/ofelia-comments'
import { ofeliaDutyModel } from '../model/ofelia-duty'
import { ofeliaContext } from './ofelia-context'
import type { OfeliaCard, OfeliaContextValue } from './ofelia-context'
import { CompactTier } from './tiers/CompactTier'
import { FullscreenTier } from './tiers/FullscreenTier'
import { LargeTier } from './tiers/LargeTier'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'
import { makeOfeliaViewModel } from './view-model'

import styles from './ofelia-poop-duty.module.css'

const EMPTY_LITTER_TEXT = 'Лоток появится, когда в виджете «Кошки» будет кошка'

// The card-management chrome of a state that is not ready: never "Развернуть" (there is nothing
// to expand yet), but always "Удалить" on the board and "Закрыть" in fullscreen, so a card stuck
// loading or failing can still be removed or left.
function notReadyChrome(chrome: WidgetChrome): WidgetChrome {
  return { onDelete: chrome.onDelete, onClose: chrome.onClose }
}

function renderLoading(tier: WidgetTier, chrome: WidgetChrome) {
  return (
    <div className={styles.widget} data-tier={tier}>
      <WidgetControls placement="overlay" {...notReadyChrome(chrome)} />
      <div className={styles.loading}>
        <div
          data-slot="skeleton"
          aria-label="Загрузка виджета «Лоток»"
          className={`animate-pulse rounded-md bg-accent ${styles.loadingSkeleton}`}
        />
      </div>
    </div>
  )
}

function renderLoadError(tier: WidgetTier, chrome: WidgetChrome, onRetry: () => void) {
  return (
    <div className={styles.widget} data-tier={tier}>
      <WidgetControls placement="overlay" {...notReadyChrome(chrome)} />
      <div className={styles.loading}>
        <div className={styles.loadError} role="alert">
          <p>Не удалось загрузить виджет «Лоток»</p>
          <button type="button" onClick={onRetry}>
            Повторить
          </button>
        </div>
      </div>
    </div>
  )
}

// Ruling 10, page 05 frame C: no cat yet, so no litter to show. The card keeps its header row with
// the controls at its end, as drawn; the tiny tier has no room for one and gets the corner controls.
function renderEmpty(tier: WidgetTier, chrome: WidgetChrome) {
  const controls = notReadyChrome(chrome)
  return (
    <div className={styles.widget} data-tier={tier}>
      <div className={styles.empty}>
        {tier === 'tiny' ? (
          <WidgetControls placement="overlay" {...controls} />
        ) : (
          <CatCardHeader
            icon={<Cat aria-hidden />}
            title="Лоток"
            switcher={null}
            chrome={controls}
          />
        )}
        <p role="status" className={styles.emptyText}>
          {EMPTY_LITTER_TEXT}
        </p>
      </div>
    </div>
  )
}

export const OfeliaPoopDuty = reatomMemo(() => {
  const { tier, modules, storage } = useWidgetContext()
  // Up here, before any early return: the loading, error and empty branches draw the controls too.
  const { onExpand, onDelete, onClose } = useWidgetChrome()
  // One object per set of callbacks (they are stable), so the memoized ready view is not
  // re-rendered for a fresh object on every render of this one.
  const chrome = useMemo<WidgetChrome>(
    () => ({ onExpand, onDelete, onClose }),
    [onExpand, onDelete, onClose],
  )
  const manage = useManageCats()
  // One module handle and one litter choice per mount: the load starts when `model` gains this
  // component as a subscriber, and the model is kept once it arrives.
  const { handle, choice } = useMemo(() => {
    const handle = reatomModule({ modules, module: catsModule, name: 'ofeliaPoopDuty.module' })
    const choice = makeLitterChoice({
      model: handle.model,
      storage: storage.instance.server,
      name: 'ofeliaPoopDuty.card',
    })
    return { handle, choice }
  }, [modules, storage])
  const card = useMemo<OfeliaCard>(() => ({ choice, manage }), [choice, manage])
  const onRetry = useMemo(() => wrap(() => handle.retry()), [handle])

  // Read unconditionally so the hook set stays fixed whichever branch returns.
  const cats = useAtomValue(handle.model)
  const loadError = useAtomValue(handle.error)
  const options = useAtomValue(choice.options)
  const current = useAtomValue(choice.current)
  const litter = useAtomValue(choice.litter)
  if (cats === null) {
    // A module chunk that failed to load is a real failure with a way out, not
    // an endless skeleton.
    if (loadError) return renderLoadError(tier, chrome, onRetry)
    return renderLoading(tier, chrome)
  }

  // Never a hard-coded litter: with none offered the card says why (ruling 10).
  if (options?.length === 0) return renderEmpty(tier, chrome)
  // The registry, or this card's stored choice, is still being read.
  if (current === null || litter === null) return renderLoading(tier, chrome)

  // Keyed by the litter, so a switch starts the day and week view afresh. `litter()` is memoized,
  // so every render hands the same model down.
  return <OfeliaPoopDutyReady key={current.id} ofelia={litter} card={card} chrome={chrome} />
}, 'OfeliaPoopDuty')

type OfeliaPoopDutyReadyProps = {
  ofelia: LitterModel
  card: OfeliaCard
  chrome: WidgetChrome
}

const OfeliaPoopDutyReady = reatomMemo<OfeliaPoopDutyReadyProps>(({ ofelia, card, chrome }) => {
  const { tier, identity, requestClose } = useWidgetContext()
  const dutyModel = useMemo(() => ofeliaDutyModel({ ofelia }), [ofelia])
  const commentsModel = useMemo(
    () => ofeliaCommentsModel({ ofelia, viewWeekStart: dutyModel.viewWeekStart }),
    [ofelia, dutyModel],
  )

  // One stable, model-scoped context value. `view` is the atomic view-model — a
  // record of focused computeds (`view.selected()`, `view.balance()`, …) — so each
  // tier subscribes to a single slice. The wrapped handlers are built once and read
  // the resolved selected day via `view.selected()` at call time, so an action
  // always hits the day the panel shows (no stale per-render `targetDate`).
  const value = useMemo<OfeliaContextValue>(() => {
    const view = makeOfeliaViewModel(dutyModel)

    const targetDate = (): Temporal.PlainDate | null => {
      const iso = view.selected()?.iso
      return iso ? Temporal.PlainDate.from(iso) : null
    }

    return {
      card,
      view,
      history: dutyModel.historyView,
      today: dutyModel.today,
      comments: commentsModel.commentThread,
      // F14: `commentsBlocked` is only true when `comments` has never resolved
      // for the currently viewed week — the case where trusting it would show
      // a different week's rows. A failure on an already-loaded week is a
      // separate, non-destructive `commentsWarning` below.
      commentsFailed: commentsModel.commentsBlocked,
      // LOW finding: this derived state used to be built here in the
      // component instead of living next to `commentsBlocked` in
      // `model/ofelia-comments.ts` — moved so both are pinned by the same
      // model test asserting they're never simultaneously true.
      commentsWarning: commentsModel.commentsWarning,
      viewer: identity.viewer,
      actions: {
        onConfirm: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.confirmClean(date)
        }),
        onUndo: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.undo(date)
        }),
        onDebt: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.goIntoDebt(date)
        }),
        onForgive: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.forgive(date)
        }),
        onSelectDay: wrap((iso: string) =>
          dutyModel.selectedDate.set(Temporal.PlainDate.from(iso)),
        ),
      },
      nav: {
        onPrevWeek: wrap(() => {
          dutyModel.goToPrevWeek()
          dutyModel.selectedDate.set(null)
        }),
        onNextWeek: wrap(() => {
          dutyModel.goToNextWeek()
          dutyModel.selectedDate.set(null)
        }),
        onCurrentWeek: wrap(() => {
          dutyModel.goToCurrentWeek()
          dutyModel.selectedDate.set(null)
        }),
      },
      onSend: wrap((text: string) => commentsModel.send(text)),
    }
  }, [card, dutyModel, commentsModel, identity])

  // The loading guard subscribes to just the boolean readiness slice; the first
  // server-time sync flips it to true and the tiers (reading other slices) mount.
  // Read race-free (useSyncExternalStore) so a warm /api/time response that lands
  // in the render→subscribe window isn't dropped, leaving the card stuck loading.
  // `loadFailed` is read the same way, unconditionally, so this stays a single
  // fixed set of hooks regardless of which branch below returns (F2c): a ledger
  // read failure otherwise pins `ready` at false forever with nothing to show
  // for it but an endless skeleton.
  const ready = useAtomValue(value.view.ready)
  const loadFailed = useAtomValue(value.view.loadFailed)
  if (!ready) {
    if (loadFailed) {
      return renderLoadError(
        tier,
        chrome,
        wrap(() => dutyModel.retryLedger()),
      )
    }

    return renderLoading(tier, chrome)
  }

  // Card management controls (expand/delete) only make sense on the board card
  // itself; useWidgetChrome already withholds them on the fullscreen mount,
  // which renders with mode="large".
  let content: ReactNode = null
  switch (tier) {
    case 'tiny':
      content = <TinyTier chrome={chrome} />
      break
    case 'compact':
      content = <CompactTier chrome={chrome} />
      break
    case 'standard':
      content = <StandardTier chrome={chrome} />
      break
    case 'large':
      content = <LargeTier chrome={chrome} />
      break
    case 'fullscreen':
      content = <FullscreenTier onClose={requestClose} />
      break
  }

  return (
    <div className={styles.widget} data-tier={tier satisfies WidgetTier}>
      <ofeliaContext.Provider value={value}>{content}</ofeliaContext.Provider>
    </div>
  )
}, 'OfeliaPoopDutyReady')
