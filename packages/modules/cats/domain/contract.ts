import { defineModuleContract } from '@shared/modules/contracts'

import { catsActionSchemas } from './actions'

export const catsContract = defineModuleContract({
  scopes: ['shared'],
  actions: catsActionSchemas,
})
