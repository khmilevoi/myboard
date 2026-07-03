import { defineWidgetServer } from '@shared/widgets/contracts'

import { clockEventSchemas } from './types'

export const clockServer = defineWidgetServer({
  schemas: clockEventSchemas,
  handlers: {},
})

export default clockServer
