import { wrap } from '@reatom/core'
import { Camera, LogOut, Monitor, Plus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { hostRuntime, http } from '@/runtime'

import { firstNameOf, initialsOf, pluralize } from '../model/account-format'
import { makeAccountMenuModel } from '../model/account-menu-model'
import { type AccountModel, createAccountModel } from '../model/account-model'
import { type AvatarCropModel, makeAvatarCropModel } from '../model/avatar-crop-model'
import { AvatarCropDialog } from './AvatarCropDialog'
import { MyDevicesDialog } from './MyDevicesDialog'
import { ProfileDialog } from './ProfileDialog'

import styles from './AccountMenu.module.css'

export type AccountMenuProps = {
  /** Injectable for tests; defaults to a fresh `createAccountModel()` instance. */
  model?: AccountModel
  /** Injectable for tests; defaults to a crop model that uploads through `model`. */
  cropModel?: AvatarCropModel
}

/** What the avatar upload accepts — the server's AVATAR_POLICY. */
const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp'

export const AccountMenu = reatomMemo<AccountMenuProps>(
  ({ model: modelOverride, cropModel: cropModelOverride }) => {
    // One model instance per mounted menu -- this is the sole owner/consumer of
    // account-model.ts in the board client (mirrors ActivateScreen's identical
    // "one model instance per mounted screen" convention). MyDevicesDialog is
    // rendered below from inside this same component and reuses this instance
    // (never creates its own), so both surfaces always agree on `account`/
    // `devices`/`pending`.
    const [model] = useState(
      () =>
        modelOverride ??
        createAccountModel({ http, refreshIdentity: () => hostRuntime.identity.refresh() }),
    )
    // One crop dialog for both ways in — the menu's camera badge and the profile's photo button.
    const [crop] = useState(
      () => cropModelOverride ?? makeAvatarCropModel({ upload: model.uploadAvatar }),
    )
    // Which surface is open: this dropdown, the profile, the devices dialog. Instance-scoped, like
    // the models above, since the menu has exactly one mount point (the header).
    const [surfaces] = useState(() => makeAccountMenuModel(crop))
    // The one picker for both ways in. It lives outside the dropdown and the dialogs: their content
    // unmounts on close, the input must not.
    const fileInput = useRef<HTMLInputElement>(null)

    useEffect(() => {
      void model.refresh()
      return model.connectEvents()
    }, [model])

    const account = model.account()
    const devices = model.devices()
    const pending = model.pending()
    const open = surfaces.menuOpen()
    const profileOpen = surfaces.profileOpen()

    const name = account?.name ?? ''
    const initials = name ? initialsOf(name) : ''
    const avatarUrl = account?.avatarUrl

    const pickAvatar = wrap((event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      // Reset so picking the same file again still fires change.
      event.currentTarget.value = ''
      if (file) surfaces.pickAvatar(file)
    })
    const openPicker = () => fileInput.current?.click()
    const cropDialog = (
      <AvatarCropDialog model={crop} firstName={firstNameOf(name)} onPickAnother={openPicker} />
    )
    const devicesDialog = (
      <MyDevicesDialog
        model={model}
        open={surfaces.myDevicesOpen()}
        onOpenChange={wrap((next: boolean) => surfaces.myDevicesOpen.set(next))}
      />
    )
    const hasPending = pending.length > 0
    const deviceCountLabel = `${devices.length} ${pluralize(devices.length, 'устройство', 'устройства', 'устройств')}`
    const pendingLabel = `${pending.length} ${pluralize(pending.length, 'запрос', 'запроса', 'запросов')} на подключение`

    return (
      <>
        <DropdownMenu
          open={open}
          onOpenChange={wrap((next: boolean) => surfaces.menuOpen.set(next))}
        >
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.trigger} aria-label={name || 'Аккаунт'}>
              {avatarUrl ? (
                <img
                  className={styles.avatarImage}
                  src={avatarUrl}
                  alt=""
                  data-testid="account-avatar-image"
                />
              ) : (
                initials
              )}
              {hasPending ? (
                <span className={styles.badge} data-testid="account-menu-badge" />
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={22}
            className={cn(styles.content, hasPending && styles.contentPending)}
          >
            <div className={styles.head}>
              <div className={styles.headAvatar}>
                {avatarUrl ? (
                  <img
                    className={styles.headAvatarFace}
                    src={avatarUrl}
                    alt=""
                    data-testid="account-menu-head-avatar"
                  />
                ) : (
                  <span className={styles.headAvatarFace} aria-hidden>
                    {initials}
                  </span>
                )}
                {/* The pointer way to a new photo: the picker, then the crop dialog. Radix menus
                  move focus between items only, so this stays out of the tab order — the
                  keyboard way is Профиль → Сменить фото. */}
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(styles.cameraBadge, !avatarUrl && styles.cameraBadgeEmpty)}
                  aria-label={avatarUrl ? 'Сменить фото' : 'Загрузить фото'}
                  data-testid="account-avatar-badge"
                  onClick={openPicker}
                >
                  <Camera
                    size={avatarUrl ? 11 : 10}
                    strokeWidth={avatarUrl ? 2.2 : 2.4}
                    aria-hidden
                  />
                </button>
              </div>
              <div className={styles.headText}>
                <div className={styles.name}>{name}</div>
                <div className={styles.deviceCount}>{deviceCountLabel}</div>
              </div>
            </div>

            {hasPending ? (
              <div className={styles.pendingSection}>
                <DropdownMenuItem
                  className={styles.pendingItem}
                  onSelect={wrap(() => surfaces.myDevicesOpen.set(true))}
                >
                  <span className={styles.pendingIcon}>
                    <Plus size={13} strokeWidth={2.4} aria-hidden />
                  </span>
                  <span className={styles.pendingLabel}>{pendingLabel}</span>
                </DropdownMenuItem>
              </div>
            ) : null}

            <div className={styles.divider} />
            <div className={styles.section}>
              <DropdownMenuItem
                className={styles.item}
                data-testid="account-menu-profile"
                onSelect={wrap(() => surfaces.profileOpen.set(true))}
              >
                <UserRound size={16} strokeWidth={1.8} aria-hidden />
                <span>Профиль</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className={styles.item}
                onSelect={wrap(() => surfaces.myDevicesOpen.set(true))}
              >
                <Monitor size={16} strokeWidth={1.8} aria-hidden />
                <span>Мои устройства</span>
              </DropdownMenuItem>
            </div>

            <div className={styles.dividerInset} />
            <div className={styles.section}>
              <DropdownMenuItem
                className={cn(styles.item, styles.itemDestructive)}
                onSelect={wrap(() => {
                  void model.logout()
                })}
              >
                <LogOut size={16} strokeWidth={1.8} aria-hidden />
                <span>Выйти</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          accept={AVATAR_ACCEPT}
          hidden
          data-testid="account-avatar-input"
          onChange={pickAvatar}
        />
        <ProfileDialog
          model={model}
          open={profileOpen}
          onOpenChange={wrap((next: boolean) => surfaces.profileOpen.set(next))}
          onPickPhoto={openPicker}
          onOpenDevices={wrap(() => surfaces.openDevicesFromProfile())}
        >
          {profileOpen ? cropDialog : null}
          {profileOpen ? devicesDialog : null}
        </ProfileDialog>
        {/* Over the profile the crop and the devices dialog live in the profile's React tree (see
          ProfileDialog's `children`), so Radix treats them as nested layers and closing one returns
          to the profile instead of dismissing both. From the menu they stand alone. Never both:
          the profile cannot close while a modal over it is open. */}
        {profileOpen ? null : cropDialog}
        {profileOpen ? null : devicesDialog}
      </>
    )
  },
  'AccountMenu',
)
