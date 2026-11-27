/** Gateway command failure reasons the board UI branches on; the gateway package should import these. */
export const COMMAND_FAILURE_REASONS = {
  consentRejected: 'consent_rejected',
  slotsFull: 'scale_user_slots_full',
} as const
export type CommandFailureReason =
  (typeof COMMAND_FAILURE_REASONS)[keyof typeof COMMAND_FAILURE_REASONS]
