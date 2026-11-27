import type { CatSwitcherManage } from 'module-cats/ui/CatSwitcher'
import { createContext, useContext } from 'react'

import type { CatsCard } from '../model/cats-card'

/** This card's model, and what its cat switcher offers below the cats. */
export type CatsContextValue = {
  card: CatsCard
  manage: CatSwitcherManage
}

export const catsContext = createContext<CatsContextValue | null>(null)

/** The card of the `Cats` component above; a tier rendered outside it is a programming error. */
export function useCats(): CatsContextValue {
  const value = useContext(catsContext)
  if (!value) throw new Error('catsContext is not available')
  return value
}
