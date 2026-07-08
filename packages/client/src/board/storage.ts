import { hostRuntime } from '@/runtime'

/**
 * Binding module — the one board file allowed to import the composition
 * root. Deliberately OUTSIDE model/: the rule "nothing under model/ imports
 * @/runtime" holds absolutely and stays greppable
 * (`rtk grep "@/runtime" packages/client/src/board/model` must be empty).
 */
export const rootStorage = hostRuntime.makeScopedStorage('root')
