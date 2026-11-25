import { PublicWidgetError } from '@shared/widgets/public-error'

import {
  CatCareCommandSchema,
  DEFAULT_PROFILE,
  type CatCareCommand,
  type CatCareState,
  type LedgerEntry,
} from './schemas'
import { getLocalDate, MAX_FUTURE_SKEW_MS } from './time'
import { projectWaterRecords } from './water'

export { LedgerEntriesSchema, LedgerEntrySchema } from './schemas'
export type { LedgerEntry, LedgerEntryDraft } from './schemas'
export { MAX_FUTURE_SKEW_MS } from './time'
export const LEDGER_KEY = 'ledger'

export function foldLedger(entries: LedgerEntry[]): CatCareState {
  const seen = new Set<string>()
  const products = new Map<string, CatCareState['products'][number]>()
  const foods = new Map<string, CatCareState['foods'][number]>()
  const water = new Map<string, CatCareState['water'][number]>()
  const weights = new Map<string, CatCareState['weights'][number]>()
  const profileHistory: CatCareState['profileHistory'] = []
  for (const entry of entries) {
    if (seen.has(entry.mutationId)) continue
    seen.add(entry.mutationId)
    const command = entry.command
    switch (command.kind) {
      case 'profile.save':
        profileHistory.push({ ts: entry.ts, profile: command.profile })
        break
      case 'product.save':
        products.set(command.product.id, command.product)
        break
      case 'food.save':
        foods.set(command.food.id, command.food)
        break
      case 'water.save':
        water.set(command.water.id, command.water)
        break
      case 'weight.save':
        weights.set(command.weight.id, command.weight)
        break
      case 'record.delete': {
        const collection =
          command.entity === 'food' ? foods : command.entity === 'water' ? water : weights
        collection.delete(command.recordId)
        break
      }
    }
  }
  return {
    profile: profileHistory.at(-1)?.profile ?? { ...DEFAULT_PROFILE },
    profileHistory,
    products: [...products.values()],
    foods: [...foods.values()],
    water: [...water.values()],
    weights: [...weights.values()],
  }
}

export function validateCommand({
  state,
  command,
  nowMs,
}: {
  state: CatCareState
  command: CatCareCommand
  nowMs: number
}): PublicWidgetError | null {
  const parsed = CatCareCommandSchema.safeParse(command)
  if (!parsed.success)
    return new PublicWidgetError({
      code: 'cat_care_invalid_data',
      publicMessage: 'Проверьте значения в форме',
      status: 422,
    })
  const value = parsed.data
  const timestamps =
    value.kind === 'food.save'
      ? [value.food.occurredAt, value.food.observedAt]
      : value.kind === 'water.save'
        ? [value.water.occurredAt]
        : value.kind === 'weight.save'
          ? [value.weight.occurredAt]
          : []
  if (timestamps.some((at) => at !== null && at > nowMs + MAX_FUTURE_SKEW_MS)) {
    return new PublicWidgetError({
      code: 'cat_care_future_record',
      publicMessage: 'Измерение не может быть в будущем',
    })
  }
  if (
    value.kind === 'profile.save' &&
    value.profile.birthDate !== null &&
    value.profile.birthDate > getLocalDate({ occurredAt: nowMs, timeZone: value.profile.timeZone })
  ) {
    return new PublicWidgetError({
      code: 'cat_care_invalid_data',
      publicMessage: 'Дата рождения не может быть в будущем',
    })
  }
  if (value.kind === 'food.save') {
    const original = state.foods.find((record) => record.id === value.food.id)
    const product = state.products.find((item) => item.id === value.food.productId)
    if ((!product || product.archived) && original?.productId !== value.food.productId) {
      return new PublicWidgetError({
        code: 'cat_care_product_missing',
        publicMessage: 'Выберите продукт из активного каталога',
      })
    }
  }
  if (value.kind === 'water.save') {
    // Match Map.set in foldLedger: a revision retains its position for tied
    // observation timestamps. Moving it to the end changes the water balance.
    const exists = state.water.some((record) => record.id === value.water.id)
    const rows = exists
      ? state.water.map((record) => (record.id === value.water.id ? value.water : record))
      : [...state.water, value.water]
    const previousInvalid = new Set(projectWaterRecords(state.water).invalidRecordIds)
    const invalid = projectWaterRecords(rows).invalidRecordIds.some(
      (id) => id === value.water.id || !previousInvalid.has(id),
    )
    if (invalid)
      return new PublicWidgetError({
        code: 'cat_care_invalid_water_balance',
        publicMessage: 'Остаток и известные потери превышают доступную воду. Проверьте измерения.',
      })
  }
  return null
}
