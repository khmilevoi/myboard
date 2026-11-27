import { wrap } from '@reatom/core'
import { pluralRu } from '@shared/format/ru'
import { Camera, ChevronRight, CircleAlert, Monitor, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Dialog, DialogClose, DialogContent, DialogTitle } from 'widget-sdk/ui/dialog'

import { formatLongDate, initialsOf } from '../model/account-format'
import type { AccountModel } from '../model/account-model'

import styles from './ProfileDialog.module.css'

export type ProfileDialogProps = {
  /** AccountMenu's own, already refreshing instance — this dialog never owns one. */
  model: AccountModel
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "Сменить фото" / "Загрузить фото": opens the shared file picker, which leads to the crop. */
  onPickPhoto: () => void
  /** "Мои устройства": the profile gives way to the devices dialog. */
  onOpenDevices: () => void
  /**
   * The crop dialog, rendered inside this dialog's React tree. Radix then treats it as a nested
   * layer — a click or close inside the crop is inside the profile too — so closing the crop can
   * never dismiss the profile underneath (docs/agent/radix-stacked-dialogs.md).
   */
  children?: ReactNode
}

export const ProfileDialog = reatomMemo<ProfileDialogProps>(
  ({ model, open, onOpenChange, onPickPhoto, onOpenDevices, children }) => {
    const account = model.account()
    const devices = model.devices()
    const busy = model.avatarPending()
    const removeError = model.removeAvatarError()

    const name = account?.name ?? ''
    const avatarUrl = account?.avatarUrl
    const activeCount = devices.filter((device) => device.status === 'active').length
    const deviceSummary = `${activeCount} ${pluralRu(activeCount, 'устройство', 'устройства', 'устройств')}${
      account ? ` из ${account.deviceLimit}` : ''
    }`

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={styles.content}
          overlayClassName={styles.overlay}
          data-testid="profile-dialog"
          aria-describedby={undefined}
        >
          <div className={styles.header}>
            <DialogTitle className={styles.title}>Профиль</DialogTitle>
            <DialogClose asChild>
              <button type="button" aria-label="Закрыть" className={styles.close}>
                <X size={16} strokeWidth={2} aria-hidden />
              </button>
            </DialogClose>
          </div>

          <div className={styles.identity}>
            {avatarUrl ? (
              <img
                className={cn(styles.avatar, styles.avatarPhoto, busy && styles.avatarBusy)}
                src={avatarUrl}
                alt=""
                data-testid="profile-avatar-image"
              />
            ) : (
              <span className={cn(styles.avatar, styles.avatarInitials)} aria-hidden>
                {initialsOf(name)}
              </span>
            )}
            <div className={styles.identityText}>
              <div className={styles.name}>{name}</div>
              {account?.createdAt !== undefined ? (
                <div className={styles.since}>В myboard с {formatLongDate(account.createdAt)}</div>
              ) : null}
              <div className={styles.photoActions}>
                {avatarUrl ? (
                  <>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={busy}
                      data-testid="profile-change-photo"
                      onClick={onPickPhoto}
                    >
                      <Camera size={15} strokeWidth={1.9} aria-hidden />
                      Сменить фото
                    </button>
                    <button
                      type="button"
                      className={styles.removeButton}
                      disabled={busy}
                      data-testid="profile-remove-photo"
                      onClick={wrap(() => {
                        void model.removeAvatar()
                      })}
                    >
                      <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                      Удалить
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={busy}
                    data-testid="profile-upload-photo"
                    onClick={onPickPhoto}
                  >
                    <Camera size={15} strokeWidth={2} aria-hidden />
                    Загрузить фото
                  </button>
                )}
              </div>
            </div>
          </div>

          {removeError ? (
            <div className={styles.error} role="alert" data-testid="profile-error">
              <CircleAlert size={15} strokeWidth={2} className={styles.errorIcon} aria-hidden />
              <span>{removeError}</span>
            </div>
          ) : null}

          <div className={styles.sectionLabel}>Устройства</div>
          {/* The whole row opens "Мои устройства": a separate text button squeezed the summary
            into four lines on a phone. */}
          <button
            type="button"
            className={styles.devicesCard}
            aria-label={`Мои устройства: ${deviceSummary}`}
            data-testid="profile-open-devices"
            onClick={onOpenDevices}
          >
            <span className={styles.devicesIcon}>
              <Monitor size={17} strokeWidth={1.8} aria-hidden />
            </span>
            <span className={styles.devicesText}>
              <span className={styles.devicesSummary} data-testid="profile-device-summary">
                {deviceSummary}
              </span>
              <span className={styles.devicesSub}>Вход по ключу доступа</span>
            </span>
            <ChevronRight
              size={18}
              strokeWidth={1.9}
              className={styles.devicesChevron}
              aria-hidden
            />
          </button>

          {children}
        </DialogContent>
      </Dialog>
    )
  },
  'ProfileDialog',
)
