import { defineWidgetServer } from '@shared/widgets/contracts'

import { clockEventSchemas } from './types'

export const clockServer = defineWidgetServer({
  typeId: 'clock',
  schemas: clockEventSchemas,
  handlers: {},
})

export default clockServer
