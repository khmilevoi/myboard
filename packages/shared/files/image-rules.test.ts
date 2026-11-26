import { describe, expect, it } from 'vitest'

import { AVATAR_POLICY, IMAGE_MIME_TYPES, type FilePolicy } from './contract'
import { FileImageRuleError, checkImageRules } from './image-rules'

const webp = (width: number, height: number) => ({ mime: 'image/webp', width, height })

describe('checkImageRules', () => {
  it('passes anything when the policy has no image rules', () => {
    const policy: FilePolicy = { accept: IMAGE_MIME_TYPES, maxBytes: 1000 }
    expect(checkImageRules(webp(5000, 10), policy)).toBeUndefined()
  })

  it('takes a square avatar up to 512 px', () => {
    expect(checkImageRules(webp(256, 256), AVATAR_POLICY)).toBeUndefined()
    expect(checkImageRules(webp(512, 512), AVATAR_POLICY)).toBeUndefined()
  })

  it.each([
    ['not_square', webp(500, 400)],
    ['too_large', webp(1024, 1024)],
    ['not_image', { mime: 'application/pdf', width: 1, height: 1 }],
  ] as const)('rejects an avatar as %s', (reason, image) => {
    const error = checkImageRules(image, AVATAR_POLICY)
    expect(error).toBeInstanceOf(FileImageRuleError)
    expect(error?.reason).toBe(reason)
  })

  it('reports too_large before not_square, so an oversized photo names its size', () => {
    expect(checkImageRules(webp(2000, 1000), AVATAR_POLICY)?.reason).toBe('too_large')
  })

  it('enforces minSide on the shorter side', () => {
    const policy: FilePolicy = { accept: ['image/*'], maxBytes: 1000, image: { minSide: 64 } }
    expect(checkImageRules(webp(64, 640), policy)).toBeUndefined()
    const error = checkImageRules(webp(640, 63), policy)
    expect(error?.reason).toBe('too_small')
    expect(error?.message).toBe('A 640x63 image/webp image breaks the too_small rule')
  })
})
