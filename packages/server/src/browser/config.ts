import * as errore from 'errore'
import { z } from 'zod'

export type BrowserGatewayConfig = {
  baseUrl: string
  timeoutMs: number
}

export class BrowserGatewayConfigError extends errore.createTaggedError({
  name: 'BrowserGatewayConfigError',
  message: 'Invalid browser gateway configuration for $field',
}) {}

const urlSchema = z
  .string()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
  .transform((value) => value.replace(/\/+$/, ''))

const positiveIntEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().positive(),
  )

const ConfigSchema = z.object({
  BROWSER_AUTOMATION_URL: z.preprocess(
    (value) => (value === undefined || value === '' ? 'http://browser-automation:8788' : value),
    urlSchema,
  ),
  BROWSER_AUTOMATION_TIMEOUT_MS: positiveIntEnv(100_000),
})

export function loadBrowserGatewayConfig(
  env: NodeJS.ProcessEnv,
): BrowserGatewayConfigError | BrowserGatewayConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'configuration'
    return new BrowserGatewayConfigError({ field })
  }
  return {
    baseUrl: parsed.data.BROWSER_AUTOMATION_URL,
    timeoutMs: parsed.data.BROWSER_AUTOMATION_TIMEOUT_MS,
  }
}
