import { fileUrl, type FileRef } from '@shared/files/contract'

import { getAccount } from '../auth/accounts'
import { accountKey, setJson, type StoredFileRef } from '../auth/records'
import type { ValkeyOps } from '../storage/valkey'
import type { SlotIO } from './service'

/** The `slot` a blob record names for an account avatar; not a storage key. */
export function avatarSlotName(accountId: string): string {
  return `${accountKey(accountId)}#avatar`
}

export function avatarUrl(avatar: StoredFileRef | undefined): string | null {
  return avatar === undefined ? null : fileUrl(avatar.blobId)
}

export function avatarRef(avatar: StoredFileRef): FileRef {
  return { ...avatar, url: fileUrl(avatar.blobId) }
}

/**
 * The avatar slot is the `avatar` field of `account:<id>`, swapped under the account key's lock.
 * `write` re-reads the record so a change to other fields is never overwritten with a stale copy.
 */
export function accountAvatarIO(ops: ValkeyOps, accountId: string): SlotIO {
  return {
    lockKey: accountKey(accountId),
    read: async () => {
      const account = await getAccount(ops, accountId)
      if (account instanceof Error) return account
      return account.avatar?.blobId ?? null
    },
    write: async (ref) => {
      const current = await getAccount(ops, accountId)
      if (current instanceof Error) return current
      const { avatar: _previous, ...account } = current
      if (ref === null) {
        await setJson(ops, accountKey(accountId), account)
        return
      }
      const { url: _url, ...stored } = ref
      await setJson(ops, accountKey(accountId), { ...account, avatar: stored })
    },
  }
}
