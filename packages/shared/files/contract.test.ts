import { describe, expect, it } from 'vitest'

import { isValidRelativeKey } from '../storage/scoped'
import {
  AVATAR_POLICY,
  BLOB_ID_PATTERN,
  FILES_HARD_MAX_BYTES,
  FileRefSchema,
  effectiveMaxBytes,
  fileSlotInnerKey,
  fileSlotRelativeKey,
  fileUrl,
  isFileSlotKey,
  isValidBlobId,
  mimeMatchesAccept,
  normalizeMime,
  scopedFilePath,
} from './contract'

const ref = {
  blobId: 'AbCdEfGhIjKlMnOpQrStUv',
  url: '/files/AbCdEfGhIjKlMnOpQrStUv',
  mime: 'image/webp',
  size: 1234,
  image: { width: 256, height: 256 },
  updatedAt: 1_700_000_000_000,
}

describe('files contract', () => {
  it('caps every upload at 25 MiB and avatars at 2 MiB of png/jpeg/webp', () => {
    expect(FILES_HARD_MAX_BYTES).toBe(26_214_400)
    expect(AVATAR_POLICY).toEqual({
      accept: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 2_097_152,
    })
    expect(effectiveMaxBytes({ accept: ['*/*'], maxBytes: 10 ** 9 })).toBe(FILES_HARD_MAX_BYTES)
    expect(effectiveMaxBytes({ accept: ['*/*'], maxBytes: 10 })).toBe(10)
  })

  it('builds the read url from the blob id', () => {
    expect(fileUrl('abc')).toBe('/files/abc')
  })

  it.each(['AbCdEfGhIjKlMnOp', 'a-b_c'.repeat(4), 'x'.repeat(64)])('accepts blob id %s', (id) =>
    expect(isValidBlobId(id)).toBe(true),
  )
  it.each(['short', 'x'.repeat(65), 'has/slash.......', '../../etc/passwd', 'with space......'])(
    'rejects blob id %s',
    (id) => expect(BLOB_ID_PATTERN.test(id)).toBe(false),
  )

  it('normalizes a Content-Type to its lowercased essence', () => {
    expect(normalizeMime('Text/Plain; charset=utf-8')).toBe('text/plain')
    expect(normalizeMime('application/vnd.openxmlformats-officedocument.wordprocessingml')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml',
    )
    expect(normalizeMime('')).toBeNull()
    expect(normalizeMime('image')).toBeNull()
    expect(normalizeMime('image/png/x')).toBeNull()
    expect(normalizeMime('a b/c')).toBeNull()
  })

  it('matches exact types, families and the wildcard', () => {
    expect(mimeMatchesAccept('image/png', ['image/png'])).toBe(true)
    expect(mimeMatchesAccept('image/gif', ['image/*'])).toBe(true)
    expect(mimeMatchesAccept('application/pdf', ['*/*'])).toBe(true)
    expect(mimeMatchesAccept('application/pdf', ['image/*', 'text/plain'])).toBe(false)
    expect(mimeMatchesAccept('image/svg+xml', AVATAR_POLICY.accept)).toBe(false)
    expect(mimeMatchesAccept('image/png', [])).toBe(false)
  })

  it('puts slots under an @files/ prefix that generic keys can never produce', () => {
    expect(fileSlotRelativeKey('photo')).toBe('@files/photo')
    expect(isFileSlotKey('@files/photo')).toBe(true)
    expect(isFileSlotKey('photo')).toBe(false)
    expect(fileSlotInnerKey('@files/cats/1')).toBe('cats/1')
    expect(fileSlotInnerKey('cats/1')).toBeNull()
    expect(isValidRelativeKey(fileSlotRelativeKey('photo'))).toBe(false)
  })

  it('builds the scoped file path with encoded id and key', () => {
    expect(scopedFilePath({ owner: 'module', id: 'ofelia', scope: 'shared' }, 'cats/1')).toBe(
      '/api/files/scoped/module/ofelia/shared/cats%2F1',
    )
    expect(scopedFilePath({ owner: 'widget', id: 'notes', scope: 'account' }, 'pic')).toBe(
      '/api/files/scoped/widget/notes/account/pic',
    )
  })

  it('parses a file ref, with or without the optional fields, and rejects a bad one', () => {
    expect(FileRefSchema.parse(ref)).toEqual(ref)
    const plain = { ...ref, mime: 'application/pdf', name: 'a.pdf', image: undefined }
    expect(FileRefSchema.safeParse(plain).success).toBe(true)
    expect(FileRefSchema.safeParse({ ...ref, blobId: '../x' }).success).toBe(false)
    expect(FileRefSchema.safeParse({ ...ref, image: { width: 0, height: 1 } }).success).toBe(false)
  })
})
