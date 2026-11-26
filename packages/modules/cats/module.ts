import { defineModule } from 'widget-runtime/define-module'

import { catsContract } from './domain/contract'

export default defineModule({
  ...catsContract,
  loadModel: () => import('./model').then((m) => m.makeOfeliaModel),
})
