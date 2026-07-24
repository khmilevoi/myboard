import { createContext, useContext } from 'react'

import type { PassportCheckModel } from '../model/check-model'
import type { RecoveryFlow } from '../model/recovery-flow'
import type { RecoveryModel } from '../model/recovery-model'

export type PassportCheckerContextValue = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
  recoveryFlow: RecoveryFlow
}

export const passportCheckerContext = createContext<PassportCheckerContextValue | null>(null)

export function usePassportChecker(): PassportCheckerContextValue {
  const value = useContext(passportCheckerContext)
  if (!value) throw new Error('passportCheckerContext is not available')
  return value
}
