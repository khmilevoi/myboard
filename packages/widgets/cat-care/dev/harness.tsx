import { lazy, Suspense } from 'react'
import { makeHostRuntime, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import client from '../client'

const Widget = lazy(client.loadComponent)
const runtime = makeHostRuntime()

export function harnessProps(): WidgetRuntimeProps {
  return {
    instanceId: 'dev:cat-care',
    typeId: 'cat-care',
    mode: 'large',
    tier: 'fullscreen',
    theme: 'light',
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[cat-care harness]', error),
    storage: runtime.makeWidgetStorage({ instanceId: 'dev:cat-care', typeId: 'cat-care' }),
    api: runtime.makeWidgetApi({ instanceId: 'dev:cat-care', typeId: 'cat-care' }),
    identity: runtime.identity,
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
  'CatCareHarness',
)
