import { defineModule } from 'widget-runtime/define-module'

import { healthContract } from './domain/contract'

export default defineModule({
  ...healthContract,
  loadModel: () => import('./model').then((m) => m.makeHealthModel),
})
