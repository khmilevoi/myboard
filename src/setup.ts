import { connectLogger } from '@reatom/core'
import { env } from './env'

if (env.DEV) {
  connectLogger()
}
