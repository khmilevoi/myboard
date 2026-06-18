import type { Rec } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { memo, type ComponentType, type NamedExoticComponent, type ReactNode } from 'react'

type ReatomMemoOptions =
  | string
  | {
      deps?: Array<string>
      name?: string
      abortOnUnmount?: boolean
    }

export function reatomMemo<Props extends Rec = Rec>(
  component: (props: Props) => ReactNode,
  options?: ReatomMemoOptions,
): NamedExoticComponent<Props> {
  return memo(reatomComponent<Props>(component, options) as ComponentType<Props>)
}
