import type { AtomLike } from '@reatom/core'
import { createContext, useContext } from 'react'
import type { BoardMember } from 'widget-runtime'

import type { CommentView } from '../model/ofelia-comments'
import type { HistoryDayGroup } from '../model/ofelia-duty'
import type { OfeliaActions, OfeliaViewModel, OfeliaWeekNav } from './view-model'

export type OfeliaContextValue = {
  // The atomic view-model: a record of focused computeds (consumers call
  // `view.selected()`, `view.balance()`, … so each subscribes to one slice).
  view: OfeliaViewModel
  history: AtomLike<HistoryDayGroup[]>
  /** The duty-zone calendar day, so history headers can say сегодня / вчера. */
  today: AtomLike<Temporal.PlainDate | null>
  comments: AtomLike<CommentView[]>
  /** True only when the viewed week's read has failed AND `comments` has never
   *  resolved for this exact key (F14): rendering it would show a DIFFERENT
   *  week's rows under the currently selected week. The UI must gate on this
   *  before trusting `comments`. */
  commentsFailed: AtomLike<boolean>
  /** True when the viewed week's read has failed but `comments` already holds
   *  that same week's rows (a transient re-fetch/push failure) — show a
   *  non-destructive banner alongside the existing rows instead of hiding them. */
  commentsWarning: AtomLike<boolean>
  /** The signed-in account, or null until the members directory arrives. */
  viewer: AtomLike<BoardMember | null>
  actions: OfeliaActions
  nav: OfeliaWeekNav
  onSend: (text: string) => Promise<void>
}

export const ofeliaContext = createContext<OfeliaContextValue | null>(null)

export function useOfelia(): OfeliaContextValue {
  const value = useContext(ofeliaContext)
  if (!value) throw new Error('OfeliaContext is not available')
  return value
}
