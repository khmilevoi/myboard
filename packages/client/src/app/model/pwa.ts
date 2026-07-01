import { atom } from '@reatom/core'
import { registerSW } from 'virtual:pwa-register'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export const needRefreshAtom = atom(false, 'pwa.needRefresh')

let _updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined

export function applyUpdate() {
  void _updateSW?.(true)
}

export function registerAppServiceWorker() {
  _updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefreshAtom.set(true)
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      window.setInterval(() => {
        void registration.update()
      }, UPDATE_CHECK_INTERVAL_MS)
    },
    onRegisterError(error) {
      console.warn('Service worker registration failed:', error)
    },
  })
}
