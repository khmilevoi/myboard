import type { HttpLike } from '@shared/http/client'
import type { InferWidgetEvents, WidgetApi, WidgetEventSchemas } from '@shared/widgets/contracts'
import * as errore from 'errore'

import { type ApiFailure, readApiEnvelope } from '../widget-api'

export class ModuleApiError extends errore.createTaggedError({
  name: 'ModuleApiError',
  message: 'Module API request failed: $reason',
}) {
  readonly code: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ code, meta, ...options }: ApiFailure) {
    super(options)
    this.code = code
    this.meta = meta
  }
}

export type ModuleApi<Actions extends WidgetEventSchemas> = WidgetApi<
  InferWidgetEvents<Actions>,
  ModuleApiError
>

export type MakeModuleApiOptions = {
  moduleId: string
  http: HttpLike
}

export function makeModuleApi<Actions extends WidgetEventSchemas>({
  moduleId,
  http,
}: MakeModuleApiOptions): ModuleApi<Actions> {
  return {
    async invoke(action, payload) {
      const url = `/api/modules/${encodeURIComponent(moduleId)}/actions/${encodeURIComponent(action)}`
      const response = await http.post(url, { json: { payload } })
      const outcome = readApiEnvelope(response)
      if ('failure' in outcome) return new ModuleApiError(outcome.failure)
      return outcome.data as InferWidgetEvents<Actions>[typeof action]['result']
    },
  }
}
