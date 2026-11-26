import { AVATAR_POLICY, FILES_HARD_MAX_BYTES } from '@shared/files/contract'
import { describe, expect, it } from 'vitest'

import { PDF_BYTES, SVG_BYTES, gifBytes, pngBytes } from '../test/file-fixtures'
import {
  FileTooLargeError,
  FileTypeInvalidError,
  FileTypeMismatchError,
  FileTypeNotAcceptedError,
} from './errors'
import { contentDisposition, inspectUpload, isInlineSafe, sanitizeFileName } from './upload'

const anything = { accept: ['*/*'], maxBytes: FILES_HARD_MAX_BYTES }

describe('inspectUpload', () => {
  it('accepts a confirmed image and reads its size', () => {
    const result = inspectUpload({
      bytes: pngBytes(64, 32),
      declaredType: 'image/png',
      name: 'cat.png',
      policy: AVATAR_POLICY,
    })
    expect(result).toEqual({
      mime: 'image/png',
      size: pngBytes(64, 32).byteLength,
      image: { width: 64, height: 32 },
      name: 'cat.png',
    })
  })

  it('refuses a body over the policy limit with 413', () => {
    const result = inspectUpload({
      bytes: new Uint8Array(11),
      declaredType: 'text/plain',
      name: null,
      policy: { accept: ['*/*'], maxBytes: 10 },
    })
    expect(result).toBeInstanceOf(FileTooLargeError)
    expect((result as FileTooLargeError).status).toBe(413)
  })

  it('clamps a generous policy to the hard cap', () => {
    const result = inspectUpload({
      bytes: new Uint8Array(FILES_HARD_MAX_BYTES + 1),
      declaredType: 'application/octet-stream',
      name: null,
      policy: { accept: ['*/*'], maxBytes: 10 * FILES_HARD_MAX_BYTES },
    })
    expect(result).toBeInstanceOf(FileTooLargeError)
  })

  it.each([undefined, '', 'nonsense', 'a b/c'])('refuses declared type %s with 415', (type) => {
    const result = inspectUpload({
      bytes: pngBytes(1, 1),
      declaredType: type,
      name: null,
      policy: anything,
    })
    expect(result).toBeInstanceOf(FileTypeInvalidError)
    expect((result as FileTypeInvalidError).status).toBe(415)
  })

  it('refuses a declared sniffable type the bytes do not confirm', () => {
    expect(
      inspectUpload({ bytes: SVG_BYTES, declaredType: 'image/png', name: null, policy: anything }),
    ).toBeInstanceOf(FileTypeMismatchError)
    expect(
      inspectUpload({
        bytes: gifBytes(1, 1),
        declaredType: 'application/pdf',
        name: null,
        policy: anything,
      }),
    ).toBeInstanceOf(FileTypeMismatchError)
  })

  it('trusts the bytes over a vague declared type', () => {
    const result = inspectUpload({
      bytes: PDF_BYTES,
      declaredType: 'application/octet-stream',
      name: null,
      policy: { accept: ['application/pdf'], maxBytes: 1000 },
    })
    expect(result).toMatchObject({ mime: 'application/pdf', image: null })
  })

  it('takes an unsniffable declared type and normalizes it', () => {
    const result = inspectUpload({
      bytes: new TextEncoder().encode('hello'),
      declaredType: 'Text/Plain; charset=utf-8',
      name: null,
      policy: { accept: ['text/*'], maxBytes: 1000 },
    })
    expect(result).toMatchObject({ mime: 'text/plain', size: 5, image: null })
  })

  it('refuses a type the policy does not accept', () => {
    expect(
      inspectUpload({
        bytes: SVG_BYTES,
        declaredType: 'image/svg+xml',
        name: null,
        policy: AVATAR_POLICY,
      }),
    ).toBeInstanceOf(FileTypeNotAcceptedError)
    expect(
      inspectUpload({
        bytes: gifBytes(2, 2),
        declaredType: 'image/gif',
        name: null,
        policy: AVATAR_POLICY,
      }),
    ).toBeInstanceOf(FileTypeNotAcceptedError)
  })
})

describe('sanitizeFileName', () => {
  it('decodes and keeps a plain name', () => {
    expect(sanitizeFileName(encodeURIComponent('Отчёт за май.pdf'))).toBe('Отчёт за май.pdf')
  })

  it('drops path separators and control characters', () => {
    expect(sanitizeFileName(encodeURIComponent('../../etc/pass\nwd'))).toBe('....etcpasswd')
    expect(sanitizeFileName('a%5Cb')).toBe('ab')
  })

  it('caps the length at 200 characters', () => {
    expect(sanitizeFileName('x'.repeat(500))).toHaveLength(200)
  })

  it('takes an invalid encoding literally, and nothing usable is null', () => {
    expect(sanitizeFileName('100%.txt')).toBe('100%.txt')
    expect(sanitizeFileName(undefined)).toBeNull()
    expect(sanitizeFileName('%2F%2F')).toBeNull()
  })
})

describe('contentDisposition', () => {
  it.each(['image/png', 'image/avif', 'application/pdf', 'text/plain', 'audio/ogg', 'video/mp4'])(
    'shows %s inline',
    (mime) => {
      expect(isInlineSafe(mime)).toBe(true)
      expect(contentDisposition(mime, null)).toBe('inline')
    },
  )

  it.each(['image/svg+xml', 'text/html', 'application/zip', 'application/octet-stream'])(
    'downloads %s',
    (mime) => {
      expect(isInlineSafe(mime)).toBe(false)
      expect(contentDisposition(mime, null)).toBe('attachment')
    },
  )

  it('carries the file name with an ASCII fallback and an RFC 5987 form', () => {
    expect(contentDisposition('application/zip', 'Фото "кот" (1).zip')).toBe(
      'attachment; filename="____ _____ (1).zip"; ' +
        "filename*=UTF-8''%D0%A4%D0%BE%D1%82%D0%BE%20%22%D0%BA%D0%BE%D1%82%22%20%281%29.zip",
    )
    expect(contentDisposition('image/png', 'cat.png')).toBe(
      `inline; filename="cat.png"; filename*=UTF-8''cat.png`,
    )
  })
})
