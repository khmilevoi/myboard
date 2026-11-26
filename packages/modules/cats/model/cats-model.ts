import { makeLitterModel, type CatsModuleContext, type LitterModel } from './litter-model'

/** The one cats-module model per board. Per-entity state lives in memoized sub-models. */
export type CatsModel = {
  /** The same `LitterModel` for the same id, so every view of a litter shares its atoms. */
  litter(litterId: string): LitterModel
}

export function makeCatsModel(context: CatsModuleContext): CatsModel {
  const litters = new Map<string, LitterModel>()

  const litter = (litterId: string): LitterModel => {
    let model = litters.get(litterId)
    if (!model) {
      model = makeLitterModel(context, litterId)
      litters.set(litterId, model)
    }
    return model
  }

  return { litter }
}
