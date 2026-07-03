import { lazy, Suspense } from 'react'
import { makeWidgetApi, makeWidgetStorage, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import client from '../client'

const Widget = lazy(client.loadComponent)

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

export const HarnessApp = reatomMemo(
  () => (
    <Suspense fallback={null}>
      <WidgetRuntimeContext.Provider value={harnessProps()}>
        <Widget />
      </WidgetRuntimeContext.Provider>
    </Suspense>
  ),
  'OfeliaHarness',
)
