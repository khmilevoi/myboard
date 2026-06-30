import { wrap } from '@reatom/core'
import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { useAtomValue } from '@/shared/reatom/use-atom-value'
import { getServerTime } from '@/shared/timer/model/server-time'
import type { WidgetTier } from '@/widget-host/model/tier'
import type { WidgetRuntimeProps } from '@/widget-host/model/types'

import { ofeliaCommentsModel } from '../model/ofelia-comments'
import { ofeliaDutyModel } from '../model/ofelia-duty'
import type { Person } from '../model/ofelia-duty'
import type { OfeliaEvents } from '../types'
import { ofeliaContext } from './ofelia-context'
import type { OfeliaContextValue } from './ofelia-context'
import { CompactTier } from './tiers/CompactTier'
import { FullscreenTier } from './tiers/FullscreenTier'
import { LargeTier } from './tiers/LargeTier'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'
import { makeOfeliaViewModel } from './view-model'

import styles from './ofelia-poop-duty.module.css'

export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps<OfeliaEvents>>(
  ({ mode, tier, storage, requestFullscreen, requestClose, requestDelete }) => {
    const dutyModel = useMemo(() => ofeliaDutyModel({ storage, timer: getServerTime() }), [storage])
    const commentsModel = useMemo(
      () =>
        ofeliaCommentsModel({
          storage,
          viewWeekStart: dutyModel.viewWeekStart,
          currentUser: dutyModel.currentUser,
        }),
      [storage, dutyModel],
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
        view,
        currentUser: dutyModel.currentUser,
        history: dutyModel.historyView,
        comments: commentsModel.commentThread,
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
          onSetUser: wrap((person: Person) => dutyModel.currentUser.set(person)),
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
    }, [dutyModel, commentsModel])

    // The loading guard subscribes to just the boolean readiness slice; the first
    // server-time sync flips it to true and the tiers (reading other slices) mount.
    // Read race-free (useSyncExternalStore) so a warm /api/time response that lands
    // in the render→subscribe window isn't dropped, leaving the card stuck loading.
    if (!useAtomValue(value.view.ready)) {
      return (
        <div className={styles.widget} data-tier={tier}>
          <div className={styles.loading}>
            <div
              data-slot="skeleton"
              aria-label="Загрузка виджета Офелии"
              className={`animate-pulse rounded-md bg-accent ${styles.loadingSkeleton}`}
            />
          </div>
        </div>
      )
    }

    // Card management controls (expand/delete) only make sense on the board
    // card itself — the fullscreen dialog already provides its own close
    // affordance, so neither callback is handed to that tier.
    const onExpand = mode === 'small' ? requestFullscreen : undefined
    const onDelete = mode === 'small' ? requestDelete : undefined

    let content: ReactNode = null
    switch (tier) {
      case 'tiny':
        content = <TinyTier onExpand={onExpand} onDelete={onDelete} />
        break
      case 'compact':
        content = <CompactTier onExpand={onExpand} onDelete={onDelete} />
        break
      case 'standard':
        content = <StandardTier onExpand={onExpand} onDelete={onDelete} />
        break
      case 'large':
        content = <LargeTier onExpand={onExpand} onDelete={onDelete} />
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
  },
  'OfeliaPoopDuty',
)
