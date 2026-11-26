import { ACCOUNT_AVATAR_PATH, FileRefSchema, type FileRef } from '@shared/files/contract'
import type { HttpLike } from '@shared/http/client'
import * as errore from 'errore'
import { z } from 'zod'

/** The avatar request never produced a usable response (offline, broken body). */
export class AvatarHttpError extends errore.createTaggedError({
  name: 'AvatarHttpError',
  message: 'Avatar request failed: $reason',
}) {}

/** A non-2xx answer from the avatar routes; `code` is the server's `error.code`. */
export class AvatarApiError extends errore.createTaggedError({
  name: 'AvatarApiError',
  message: 'Avatar request answered $status ($code)',
}) {}

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) })
const RefEnvelopeSchema = z.object({ value: FileRefSchema })

function apiError(status: number, body: unknown): AvatarApiError {
  const parsed = ErrorBodySchema.safeParse(body)
  return new AvatarApiError({
    status: String(status),
    code: parsed.success ? parsed.data.error.code : 'unknown_error',
  })
}

/** Uploads a prepared avatar for the session's own account. */
export async function putAvatar(
  http: HttpLike,
  blob: Blob,
): Promise<AvatarHttpError | AvatarApiError | FileRef> {
  const res = await http.put(ACCOUNT_AVATAR_PATH, {
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (res instanceof Error) return new AvatarHttpError({ reason: 'transport', cause: res })
  if (!res.ok) return apiError(res.status, res.body)
  const envelope = RefEnvelopeSchema.safeParse(res.body)
  if (!envelope.success) {
    return new AvatarHttpError({ reason: 'invalid response', cause: envelope.error })
  }
  return envelope.data.value
}

export async function deleteAvatar(
  http: HttpLike,
): Promise<AvatarHttpError | AvatarApiError | void> {
  const res = await http.delete(ACCOUNT_AVATAR_PATH)
  if (res instanceof Error) return new AvatarHttpError({ reason: 'transport', cause: res })
  if (!res.ok) return apiError(res.status, res.body)
}

const UNREADABLE_COPY = 'Не получилось прочитать файл. Выберите фото в JPEG, PNG или WebP.'
const FAILED_COPY = 'Не удалось сохранить фото. Попробуйте ещё раз.'

/** User-facing copy for an avatar failure — design page 03, section 1b, state (h). */
export function describeAvatarError(error: Error): string {
  if (error instanceof AvatarHttpError) {
    return error.reason === 'transport'
      ? 'Не удалось загрузить фото. Проверьте подключение и попробуйте ещё раз.'
      : FAILED_COPY
  }
  if (error instanceof AvatarApiError) {
    if (error.status === '413') return 'Фото слишком большое. Выберите другое.'
    if (error.status === '415') return UNREADABLE_COPY
    if (error.status === '401') return 'Сессия истекла, войдите снова'
    return FAILED_COPY
  }
  return UNREADABLE_COPY
}
