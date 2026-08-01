import { lazy, Suspense } from 'react'
import { makeHostRuntime, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import client from '../client'

const Widget = lazy(client.loadComponent)

const DEV_ID = 'passport-checker'

const runtime = makeHostRuntime() // bare: no auth anywhere in a harness

export function harnessProps(
  tier: WidgetRuntimeProps['tier'] = 'standard',
  mode: WidgetRuntimeProps['mode'] = 'large',
): WidgetRuntimeProps {
  return {
    instanceId: `dev:${DEV_ID}`,
    typeId: DEV_ID,
    mode,
    tier,
    theme: 'light',
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[harness]', error),
    storage: runtime.makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    api: runtime.makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    identity: runtime.identity,
  }
}

/** `?tier=` accepts any runtime tier; tiny/compact preview at the small board
 *  footprint they actually ship at, everything else gets the full harness page. */
export const HarnessApp = reatomMemo(() => {
  const tierParam = new URLSearchParams(window.location.search).get('tier')
  const tier = (tierParam ?? 'standard') as WidgetRuntimeProps['tier']
  const small = tier === 'tiny' || tier === 'compact'
  const props = harnessProps(tier, small ? 'small' : 'large')
  const widget = (
    <Suspense fallback={null}>
      <WidgetRuntimeContext.Provider value={props}>
        <Widget />
      </WidgetRuntimeContext.Provider>
    </Suspense>
  )

  return small ? (
    <div data-harness-preview={tier} style={{ width: '100%', height: 110 }}>
      {widget}
    </div>
  ) : (
    widget
  )
}, 'PassportCheckerHarness')
