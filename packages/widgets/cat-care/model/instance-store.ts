import { makeWidgetInstanceStore } from 'widget-sdk'

import type { CatCareModel } from './cat-care'
import type { createCatCareForms } from './forms'

export type CatCareInstanceModels = {
  model: CatCareModel
  forms: ReturnType<typeof createCatCareForms>
}

/** Tile and fullscreen are two mounts of the same diary and its drafts. */
export const catCareInstance = makeWidgetInstanceStore<CatCareInstanceModels>({
  name: 'catCare.instance',
})
