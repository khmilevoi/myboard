import { atom, computed } from '@reatom/core'
import type { CatSummary, LitterModel } from 'module-cats'
import type { LitterCardChoice, LitterOption } from 'module-cats/card-choice'
import { DEFAULT_LITTER_SETTINGS, otherPerson } from 'module-cats/domain/roster'
import type { Person } from 'module-cats/domain/roster'
import type { CatSwitcherManage } from 'module-cats/ui/CatSwitcher'
import type { BoardMember } from 'widget-runtime'

import type { CommentView } from '../model/ofelia-comments'
import type { HistoryDayGroup } from '../model/ofelia-duty'
import type { OfeliaCard, OfeliaContextValue } from './ofelia-context'
import type {
  DebtBalanceEntry,
  OfeliaActions,
  OfeliaViewModel,
  SelectedDayView,
  WeekDayView,
} from './view-model'

const noop = async () => {}

const WEEK: WeekDayView[] = [
  {
    iso: '2026-06-15',
    weekday: 'ПН',
    dayOfMonth: 15,
    person: 'Леша',
    debtOwner: null,
    isToday: false,
    isDebtDay: false,
    isClosed: false,
    isSelected: false,
  },
  {
    iso: '2026-06-16',
    weekday: 'ВТ',
    dayOfMonth: 16,
    person: 'Карина',
    debtOwner: null,
    isToday: true,
    isDebtDay: false,
    isClosed: false,
    isSelected: true,
  },
  {
    iso: '2026-06-17',
    weekday: 'СР',
    dayOfMonth: 17,
    person: 'Карина',
    debtOwner: 'Леша',
    isToday: false,
    isDebtDay: true,
    isClosed: false,
    isSelected: false,
  },
  {
    iso: '2026-06-18',
    weekday: 'ЧТ',
    dayOfMonth: 18,
    person: 'Леша',
    debtOwner: null,
    isToday: false,
    isDebtDay: false,
    isClosed: false,
    isSelected: false,
  },
  {
    iso: '2026-06-19',
    weekday: 'ПТ',
    dayOfMonth: 19,
    person: 'Карина',
    debtOwner: null,
    isToday: false,
    isDebtDay: false,
    isClosed: false,
    isSelected: false,
  },
  {
    iso: '2026-06-20',
    weekday: 'СБ',
    dayOfMonth: 20,
    person: 'Леша',
    debtOwner: null,
    isToday: false,
    isDebtDay: false,
    isClosed: false,
    isSelected: false,
  },
  {
    iso: '2026-06-21',
    weekday: 'ВС',
    dayOfMonth: 21,
    person: 'Карина',
    debtOwner: null,
    isToday: false,
    isDebtDay: false,
    isClosed: false,
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
  loadFailed?: boolean
  selected?: SelectedDayView | null
  days?: WeekDayView[]
  balance?: DebtBalanceEntry[]
  canForgive?: boolean
  actionPending?: boolean
  actionErrorMessage?: string | null
}

export function makeOfeliaView(o: OfeliaViewOverrides = {}): OfeliaViewModel {
  const selected = o.selected === undefined ? DEFAULT_SELECTED : o.selected
  const balance = o.balance ?? DEFAULT_BALANCE

  return {
    ready: atom(o.ready ?? true, 'fixture.ready'),
    loadFailed: atom(o.loadFailed ?? false, 'fixture.loadFailed'),
    selected: atom<SelectedDayView | null>(selected, 'fixture.selected'),
    selectedPerson: atom<Person | null>(selected?.person ?? null, 'fixture.selectedPerson'),
    selectedIso: atom<string | null>(selected?.iso ?? null, 'fixture.selectedIso'),
    days: atom<WeekDayView[]>(o.days ?? WEEK, 'fixture.days'),
    balance: atom<DebtBalanceEntry[]>(balance, 'fixture.balance'),
    partner: atom<Person | null>(
      selected ? otherPerson(DEFAULT_LITTER_SETTINGS, selected.person) : null,
      'fixture.partner',
    ),
    canForgive: atom(
      o.canForgive ?? (selected?.isDebtDay === true && balance.some((entry) => entry.debt > 0)),
      'fixture.canForgive',
    ),
    actionPending: atom(o.actionPending ?? false, 'fixture.actionPending'),
    actionErrorMessage: atom<string | null>(
      o.actionErrorMessage ?? null,
      'fixture.actionErrorMessage',
    ),
  }
}

const OFELIA_CAT: CatSummary = {
  id: 'ofelia',
  name: 'Офелия',
  avatar: null,
  litterId: 'ofelia',
  tone: 'a',
}
const BUSYA_CAT: CatSummary = {
  id: 'busya',
  name: 'Буся',
  avatar: null,
  litterId: 'busya',
  tone: 'b',
}

export const OFELIA_LITTER: LitterOption = {
  id: 'ofelia',
  title: 'Лоток · Офелия',
  catIds: ['ofelia'],
  cats: [OFELIA_CAT],
}
export const BUSYA_LITTER: LitterOption = {
  id: 'busya',
  title: 'Лоток · Буся',
  catIds: ['busya'],
  cats: [BUSYA_CAT],
}

type OfeliaCardOverrides = {
  options?: LitterOption[]
  currentId?: string
  choose?: (id: string) => Promise<void>
  manage?: CatSwitcherManage
}

/** A card choice over fixed litters, the first one current; its litter has the default rotation. */
export function makeOfeliaCard(o: OfeliaCardOverrides = {}): OfeliaCard {
  const options = o.options ?? [OFELIA_LITTER]
  const current = options.find((option) => option.id === o.currentId) ?? options[0] ?? null
  const settings = computed(() => DEFAULT_LITTER_SETTINGS, 'fixture.litterSettings')
  const choice: LitterCardChoice = {
    options: computed(() => options, 'fixture.litterOptions'),
    current: computed(() => current, 'fixture.litterCurrent'),
    canSwitch: computed(() => options.length > 1, 'fixture.litterCanSwitch'),
    choose: o.choose ?? (async () => {}),
    litter: computed(() => ({ settings }) as unknown as LitterModel, 'fixture.litterModel'),
  }
  return { choice, manage: o.manage ?? { kind: 'hint' } }
}

type MakeOfeliaValueOptions = {
  card?: OfeliaCard
  view?: OfeliaViewModel
  history?: HistoryDayGroup[]
  today?: Temporal.PlainDate
  comments?: CommentView[]
  commentsFailed?: boolean
  commentsWarning?: boolean
  viewer?: BoardMember | null
  actions?: Partial<OfeliaActions>
  onSend?: (text: string) => Promise<void>
}

export function makeOfeliaValue(o: MakeOfeliaValueOptions = {}): OfeliaContextValue {
  return {
    card: o.card ?? makeOfeliaCard(),
    view: o.view ?? makeOfeliaView(),
    history: atom<HistoryDayGroup[]>(o.history ?? [], 'fixture.history'),
    today: atom<Temporal.PlainDate | null>(
      o.today ?? Temporal.PlainDate.from('2026-06-16'),
      'fixture.today',
    ),
    comments: atom<CommentView[]>(o.comments ?? [], 'fixture.comments'),
    commentsFailed: atom(o.commentsFailed ?? false, 'fixture.commentsFailed'),
    commentsWarning: atom(o.commentsWarning ?? false, 'fixture.commentsWarning'),
    viewer: atom<BoardMember | null>(o.viewer ?? null, 'fixture.viewer'),
    actions: {
      onConfirm: noop,
      onUndo: noop,
      onDebt: noop,
      onForgive: noop,
      onSelectDay: noop,
      ...o.actions,
    },
    nav: { onPrevWeek: noop, onNextWeek: noop, onCurrentWeek: noop },
    onSend: o.onSend ?? (() => Promise.resolve()),
  }
}
