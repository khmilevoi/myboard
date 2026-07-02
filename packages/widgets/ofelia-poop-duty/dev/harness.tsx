import { makeWidgetApi, makeWidgetStorage } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import Widget from '../ui/expose'

const DEV_ID = 'ofelia-poop-duty'

export function harnessProps(): WidgetRuntimeProps {
  return {
    instanceId: `dev:${DEV_ID}`,
    typeId: DEV_ID,
    mode: 'large',
    tier: 'fullscreen',
    theme: 'light',
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[harness]', error),
    storage: makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    api: makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
  }
}

export const HarnessApp = reatomMemo(() => <Widget {...harnessProps()} />, 'OfeliaHarness')
