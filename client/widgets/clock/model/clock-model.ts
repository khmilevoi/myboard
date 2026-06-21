import { atom, withConnectHook, wrap } from '@reatom/core'

export const clockNow = atom(() => new Date(), 'clock.now').extend(
  withConnectHook(() => {
    const intervalId = window.setInterval(
      wrap(() => clockNow.set(new Date())),
      1000,
    )
    return () => window.clearInterval(intervalId)
  }),
)
