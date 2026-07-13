import { type JSX } from 'react/jsx-runtime'

// Makes reatomRouter's `render`/`outlet` produce React elements. Picked up by
// the client tsconfig via `include: ["activation/src"]`. `import type` makes
// this a module so the `declare module` augmentation applies.
declare module '@reatom/core' {
  interface RouteChild extends JSX.Element {}
}
