import RFB from '@novnc/novnc'

export type RfbEventName = 'connect' | 'disconnect' | 'securityfailure'

export type RfbLike = {
  addEventListener(type: RfbEventName, listener: (event: Event) => void): void
  removeEventListener(type: RfbEventName, listener: (event: Event) => void): void
  disconnect(): void
}

export type MakeRfb = (target: HTMLElement, url: string) => RfbLike

/**
 * Prod adapter around @novnc/novnc. scaleViewport gives contain-fit with
 * letterboxing inside the 16:9 frame (RFB centers its canvas via flex +
 * margin auto against `background`).
 */
export const makeNoVncRfb: MakeRfb = (target, url) => {
  // A previous attempt may have left its screen element behind.
  target.replaceChildren()
  const rfb = new RFB(target, url, { shared: true })
  rfb.scaleViewport = true
  rfb.viewOnly = false
  rfb.background = '#16171d'
  return rfb
}
