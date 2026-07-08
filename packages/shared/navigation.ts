/**
 * One navigation seam for models. Implementations stay one-liners at
 * composition roots (e.g. `(path) => window.location.assign(path)`).
 */
export type Navigate = (path: string) => void
