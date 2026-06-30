import type { Atom, AtomLike } from '@reatom/core'
import { createContext, useContext } from 'react'

import type { CommentView } from '../model/ofelia-comments'
import type { HistoryEntryView, Person } from '../model/ofelia-duty'
import type { OfeliaActions, OfeliaViewModel, OfeliaWeekNav } from './view-model'

export type OfeliaContextValue = {
  // The atomic view-model: a record of focused computeds (consumers call
  // `view.selected()`, `view.balance()`, … so each subscribes to one slice).
  view: OfeliaViewModel
  currentUser: Atom<Person>
  history: AtomLike<HistoryEntryView[]>
  comments: AtomLike<CommentView[]>
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
