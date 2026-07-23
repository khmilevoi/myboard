import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import { z } from 'zod'

export const passportCheckPayloadSchema = z.strictObject({})
export const passportCheckResultSchema = z.object({
  status: z.number().int(),
  send_status_msg: z.string(),
})

export const passportCheckerBrowserSchemas = {
  check: {
    payload: passportCheckPayloadSchema,
    result: passportCheckResultSchema,
  },
} as const

export const passportCheckerBrowserTasks = defineWidgetBrowserTasks(passportCheckerBrowserSchemas)

export type PassportCheckPayload = z.output<typeof passportCheckPayloadSchema>
export type PassportCheckResult = z.output<typeof passportCheckResultSchema>
