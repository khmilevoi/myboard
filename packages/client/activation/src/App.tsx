import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { rootRoute } from './model/routes'

export const App = reatomMemo(() => rootRoute.render(), 'App')
