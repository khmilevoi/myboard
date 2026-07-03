import { defineWidgetServer } from '@shared/widgets/contracts'

import { ofeliaEventSchemas } from './types'

export const ofeliaServer = defineWidgetServer({
  schemas: ofeliaEventSchemas,
  handlers: {},
})

export default ofeliaServer
