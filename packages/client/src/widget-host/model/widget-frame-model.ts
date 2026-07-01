import { action, atom } from '@reatom/core'

export const widgetReloadKeys = atom<Record<string, number>>({}, 'widgetHost.reloadKeys')

export function getWidgetReloadKey(instanceId: string): number {
  return widgetReloadKeys()[instanceId] ?? 0
}

export const retryWidget = action((instanceId: string) => {
  widgetReloadKeys.set((keys) => ({
    ...keys,
    [instanceId]: (keys[instanceId] ?? 0) + 1,
  }))
}, 'widgetHost.retryWidget')
