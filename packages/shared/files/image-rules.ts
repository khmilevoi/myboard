import * as errore from 'errore'

import type { FilePolicy } from './contract'

/** Why an image breaks its slot's `FilePolicy.image` rules; the server answers it as `reason`. */
export type FileImageRuleReason = 'not_image' | 'not_square' | 'too_large' | 'too_small'

export class FileImageRuleError extends errore.createTaggedError({
  name: 'FileImageRuleError',
  message: 'A $size $mime image breaks the $reason rule',
}) {
  declare reason: FileImageRuleReason
}

export type ImageFacts = { mime: string; width: number; height: number }

/**
 * The pure check behind both sides of an upload: the browser runs it on what it is about to send,
 * the server on the dimensions a full decode produced. Nothing to check without `policy.image`.
 */
export function checkImageRules(image: ImageFacts, policy: FilePolicy): FileImageRuleError | void {
  const rules = policy.image
  if (rules === undefined) return
  const { mime, width, height } = image
  const fail = (reason: FileImageRuleReason) =>
    new FileImageRuleError({ reason, mime, size: `${width}x${height}` })
  if (!mime.startsWith('image/')) return fail('not_image')
  if (rules.maxSide !== undefined && Math.max(width, height) > rules.maxSide) {
    return fail('too_large')
  }
  if (rules.minSide !== undefined && Math.min(width, height) < rules.minSide) {
    return fail('too_small')
  }
  if (rules.square === true && width !== height) return fail('not_square')
}
