export type WidgetInstance = { id: string; typeId: string }

export type LayoutItem = {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export type BoardSnapshot = {
  instances: WidgetInstance[]
  layout: LayoutItem[]
}
