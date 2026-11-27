import { action, withAsyncData, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { LitterModel } from 'module-cats'

export type { CommentView } from 'module-cats'

export interface OfeliaCommentsModelProps {
  /** Ofelia's litter model from the cats module: the comment threads and the send action. */
  ofelia: LitterModel
  viewWeekStart: AtomLike<Temporal.PlainDate | null>
}

/** One duty card's comment thread, following the week that card is viewing. */
export const ofeliaCommentsModel = ({ ofelia, viewWeekStart }: OfeliaCommentsModelProps) => {
  const { comments, commentsError, commentsBlocked, commentsWarning, commentThread } =
    ofelia.weekComments(viewWeekStart)

  // The reactive read happens before the first `await` so it resolves against
  // this widget's context. The module returns a failure as a value; it is
  // re-thrown so `withAsyncData` tracks it in `.error()`.
  const send = action(async (text: string) => {
    const week = viewWeekStart()
    if (week == null) return

    const result = await wrap(ofelia.sendComment(week, text))
    if (result instanceof Error) throw result
  }, 'ofeliaComments.send').extend(withAsyncData({ status: true }))

  return {
    comments,
    commentsError,
    commentsBlocked,
    commentsWarning,
    commentThread,
    send,
  }
}
