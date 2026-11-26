import { action, type Action, atom, type Atom } from '@reatom/core'

import type { AvatarCropModel } from './avatar-crop-model'

/**
 * Which account surface is open: the dropdown, the profile dialog, the devices dialog. The crop
 * dialog's own open state lives in its model; this one only routes into it.
 */
export interface AccountMenuModel {
  menuOpen: Atom<boolean>
  profileOpen: Atom<boolean>
  myDevicesOpen: Atom<boolean>
  /** "Мои устройства" in the profile: the profile gives way to the devices dialog. */
  openDevicesFromProfile: Action<[], void>
  /**
   * A photo was picked — from the menu's camera badge or from the profile. The menu closes; the
   * profile stays under the crop dialog.
   */
  pickAvatar: Action<[Blob], void>
}

export function makeAccountMenuModel(crop: Pick<AvatarCropModel, 'openFile'>): AccountMenuModel {
  const menuOpen = atom(false, 'accountMenu.open')
  const profileOpen = atom(false, 'accountMenu.profileOpen')
  const myDevicesOpen = atom(false, 'accountMenu.myDevicesOpen')

  const openDevicesFromProfile = action(() => {
    profileOpen.set(false)
    myDevicesOpen.set(true)
  }, 'accountMenu.openDevicesFromProfile')

  const pickAvatar = action((file: Blob) => {
    menuOpen.set(false)
    void crop.openFile(file)
  }, 'accountMenu.pickAvatar')

  return { menuOpen, profileOpen, myDevicesOpen, openDevicesFromProfile, pickAvatar }
}
