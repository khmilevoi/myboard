import { type HardwareClientError, isHardwareError } from '@shared/hardware/board-client'

export const GATEWAY_OFFLINE_COPY = 'Шлюз не в сети.'
export const GENERIC_ACTION_ERROR_COPY = 'Не получилось. Попробуйте ещё раз.'

/** User-facing copy for a failed hardware action (Decision 20). */
export function describeHardwareError(error: HardwareClientError): string {
  if (isHardwareError(error, 'gateway_offline')) return GATEWAY_OFFLINE_COPY
  return GENERIC_ACTION_ERROR_COPY
}
