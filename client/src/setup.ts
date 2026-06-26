import { connectLogger } from '@reatom/core'

import { env } from './env'

if (env.DEV) {
  connectLogger({
    match: (name) => {
      if (name.startsWith('!')) return false

      return true
    },
  })
}
