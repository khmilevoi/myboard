import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

export const passportCheckPayloadSchema = z.strictObject({})
export const passportServiceResponseSchema = z.object({
  status: z.number().int(),
  send_status_msg: z.string(),
})

export const passportDocumentSuccessSchema = passportServiceResponseSchema.extend({
  kind: z.literal('success'),
})

export const passportDocumentErrorSchema = z.object({
  kind: z.literal('error'),
  code: z.enum(['upstream_response', 'invalid_checker_response']),
})

export const passportDocumentResultSchema = z.discriminatedUnion('kind', [
  passportDocumentSuccessSchema,
  passportDocumentErrorSchema,
])

export const passportCheckResultSchema = z.object({
  idCard: passportDocumentResultSchema,
  internationalPassport: passportDocumentResultSchema,
})

export const passportCheckerBrowserSchemas = {
  check: {
    payload: passportCheckPayloadSchema,
    result: passportCheckResultSchema,
  },
} as const

export const passportCheckerBrowserTasks = defineWidgetBrowserTasks(passportCheckerBrowserSchemas)

export type PassportCheckPayload = z.output<typeof passportCheckPayloadSchema>
export type PassportServiceResponse = z.output<typeof passportServiceResponseSchema>
export type PassportDocumentSuccess = z.output<typeof passportDocumentSuccessSchema>
export type PassportDocumentError = z.output<typeof passportDocumentErrorSchema>
export type PassportDocumentResult = z.output<typeof passportDocumentResultSchema>
export type PassportCheckResult = z.output<typeof passportCheckResultSchema>

export type PassportCheckerEvents = InferWidgetEvents<typeof passportCheckerBrowserSchemas>
