import { atom } from '@reatom/core'

import type { CommentView } from '../model/ofelia-comments'
import type { HistoryEntryView, Person } from '../model/ofelia-duty'
import type { OfeliaContextValue } from './ofelia-context'
import type {
  DebtBalanceEntry,
  OfeliaActions,
  OfeliaViewModel,
  SelectedDayView,
  WeekDayView,
} from './view-model'

const noop = () => {}

const WEEK: WeekDayView[] = [
  {
    iso: '2026-06-15',
    weekday: 'ПН',
    dayOfMonth: 15,
    person: 'Леша',
    isToday: false,
    isDebtDay: false,
    isSelected: false,
  },
  {
    iso: '2026-06-16',
    weekday: 'ВТ',
    dayOfMonth: 16,
    person: 'Карина',
    isToday: true,
    isDebtDay: false,
    isSelected: true,
  },
  {
    iso: '2026-06-17',
    weekday: 'СР',
    dayOfMonth: 17,
    person: 'Карина',
    isToday: false,
    isDebtDay: true,
    isSelected: false,
  },
  {
    iso: '2026-06-18',
    weekday: 'ЧТ',
    dayOfMonth: 18,
    person: 'Леша',
    isToday: false,
    isDebtDay: false,
    isSelected: false,
  },
  {
    iso: '2026-06-19',
    weekday: 'ПТ',
    dayOfMonth: 19,
    person: 'Карина',
    isToday: false,
    isDebtDay: false,
    isSelected: false,
  },
  {
    iso: '2026-06-20',
    weekday: 'СБ',
    dayOfMonth: 20,
    person: 'Леша',
    isToday: false,
    isDebtDay: false,
    isSelected: false,
  },
  {
    iso: '2026-06-21',
    weekday: 'ВС',
    dayOfMonth: 21,
    person: 'Карина',
    isToday: false,
    isDebtDay: false,
    isSelected: false,
  },
]

const DEFAULT_SELECTED: SelectedDayView = {
  iso: '2026-06-16',
  person: 'Карина',
  isDebtDay: true,
  status: 'pending',
  canUndo: false,
  debtRemaining: 2,
  isFuture: false,
}

const DEFAULT_BALANCE: DebtBalanceEntry[] = [
  { person: 'Леша', debt: 0, over: false },
  { person: 'Карина', debt: 2, over: false },
]

// Override API stays on plain slice values; each field is wrapped in an atom.
type OfeliaViewOverrides = {
  ready?: boolean
  selected?: SelectedDayView | null
  days?: WeekDayView[]
  balance?: DebtBalanceEntry[]
  canForgive?: boolean
}

export function makeOfeliaView(o: OfeliaViewOverrides = {}): OfeliaViewModel {
  const selected = o.selected === undefined ? DEFAULT_SELECTED : o.selected
  const balance = o.balance ?? DEFAULT_BALANCE

  return {
    ready: atom(o.ready ?? true, 'fixture.ready'),
    selected: atom<SelectedDayView | null>(selected, 'fixture.selected'),
    selectedPerson: atom<Person | null>(selected?.person ?? null, 'fixture.selectedPerson'),
    days: atom<WeekDayView[]>(o.days ?? WEEK, 'fixture.days'),
    balance: atom<DebtBalanceEntry[]>(balance, 'fixture.balance'),
    canForgive: atom(o.canForgive ?? balance.some((entry) => entry.debt > 0), 'fixture.canForgive'),
  }
}

type MakeOfeliaValueOptions = {
  view?: OfeliaViewModel
  currentUser?: Person
  history?: HistoryEntryView[]
  comments?: CommentView[]
  actions?: Partial<OfeliaActions>
  onSend?: (text: string) => void
}

export function makeOfeliaValue(o: MakeOfeliaValueOptions = {}): OfeliaContextValue {
  return {
    view: o.view ?? makeOfeliaView(),
    currentUser: atom<Person>(o.currentUser ?? 'Карина', 'fixture.currentUser'),
    history: atom<HistoryEntryView[]>(o.history ?? [], 'fixture.history'),
    comments: atom<CommentView[]>(o.comments ?? [], 'fixture.comments'),
    actions: {
      onConfirm: noop,
      onUndo: noop,
      onDebt: noop,
      onForgive: noop,
      onSelectDay: noop,
      onSetUser: noop,
      ...o.actions,
    },
    nav: { onPrevWeek: noop, onNextWeek: noop, onCurrentWeek: noop },
    onSend: o.onSend ?? noop,
  }
}
