import { defineModuleContract } from '@shared/modules/contracts'

import { ofeliaActionSchemas } from './actions'

export const ofeliaContract = defineModuleContract({
  scopes: ['shared'],
  actions: ofeliaActionSchemas,
})
