export { ofeliaModule } from './generated/module'
export type {
  CommentView,
  HistoryDayGroup,
  HistoryEntryView,
  OfeliaDayAction,
  OfeliaMemberStats,
  OfeliaModel,
  OfeliaWeekComments,
  ToHistoryGroupsOptions,
} from './model'
// Transitional: the duty widget still builds its own history view until it is
// rewired onto `OfeliaModel.historyFor`.
export { toHistoryGroups } from './model/history-view'
