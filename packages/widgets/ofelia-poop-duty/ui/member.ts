/**
 * Account tones are hashed from the account id, deliberately NOT taken from the
 * duty rotation: accounts and duty people are independent axes and there may be
 * more accounts than roster slots.
 */
export {
  AVATAR_TONES as MEMBER_TONES,
  type AvatarTone as MemberTone,
  getAvatarInitials as memberInitial,
  getAvatarTone as memberTone,
} from 'widget-sdk/ui/UserAvatar'
