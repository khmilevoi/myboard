import { defineModuleContract } from '@shared/modules/contracts'

import { healthActionSchemas } from './actions'

export const healthContract = defineModuleContract({
  scopes: ['account'],
  actions: healthActionSchemas,
})
