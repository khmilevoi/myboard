import { defineWidgetServer } from '@shared/widgets/contracts'

import { ofeliaEventSchemas } from './types'

export const ofeliaServer = defineWidgetServer({
  typeId: 'ofelia-poop-duty',
  schemas: ofeliaEventSchemas,
  handlers: {},
})

export default ofeliaServer
