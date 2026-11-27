import { wrap } from '@reatom/core'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { useOverlayBackDismiss } from 'widget-sdk/hooks/use-overlay-back-dismiss'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'widget-sdk/ui/dropdown-menu'

import type { CatSummary } from '../model/cats-model'
import { CatAvatar, CatAvatarStack, type CatAvatarSize } from './CatAvatar'

import styles from './CatSwitcher.module.css'

/** What the menu offers below the options: a link to a placed "Кошки" card, or how to add one. */
export type CatSwitcherManage = { kind: 'open'; onOpen: () => void } | { kind: 'hint' }

export type CatSwitcherOption = { id: string; label: string; cats: CatSummary[] }

export type CatSwitcherProps = {
  /** A cat card chooses a cat; a litter card chooses a litter, drawn as its cats' stack. */
  kind: 'cat' | 'litter'
  options: CatSwitcherOption[]
  currentId: string
  onChoose: (id: string) => void
  /** `menu` in a card header; `badge` is the tiny tier's corner mark, never interactive. */
  variant: 'menu' | 'badge'
  manage: CatSwitcherManage
}

export const MANAGE_CATS_LABEL = 'Управлять кошками →'
export const MANAGE_CATS_HINT =
  'Добавить или изменить кошку — в виджете «Кошки». Поставьте его на борду из каталога.'

const COPY = {
  cat: { button: 'Выбрать кошку', menu: 'Кошки' },
  litter: { button: 'Выбрать лоток', menu: 'Лотки' },
} as const

const OptionAvatar = reatomMemo<{ option: CatSwitcherOption; size: CatAvatarSize }>(
  ({ option, size }) => {
    const [only] = option.cats
    if (option.cats.length === 1 && only) {
      return <CatAvatar name={only.name} tone={only.tone} photoUrl={only.avatar} size={size} />
    }
    return <CatAvatarStack cats={option.cats} size={size} />
  },
  'CatSwitcherOptionAvatar',
)

const SwitcherMenu = reatomMemo<CatSwitcherProps & { current: CatSwitcherOption }>(
  ({ kind, options, current, onChoose, manage }) => {
    // `widget-sdk/ui/dropdown-menu` does not route through history, so the menu is controlled
    // here: every Radix close request goes through `requestDismiss`, and Back closes the menu
    // alone, never the fullscreen card underneath.
    const [open, setOpen] = useState(false)
    const requestDismiss = useOverlayBackDismiss(open, () => setOpen(false))
    const copy = COPY[kind]

    const onOpenChange = (next: boolean) => {
      if (next) setOpen(true)
      else requestDismiss()
    }

    // Opening the "Кошки" card replaces this layer in one task: closing the menu by state hands
    // its history entry straight to the fullscreen card instead of traversing back.
    const onManage = (event: Event) => {
      event.preventDefault()
      setOpen(false)
      if (manage.kind === 'open') manage.onOpen()
    }

    const Chevron = open ? ChevronUp : ChevronDown

    return (
      <DropdownMenu open={open} onOpenChange={wrap(onOpenChange)}>
        <DropdownMenuTrigger
          className={styles.trigger}
          aria-label={`${copy.button} · сейчас ${current.label}`}
        >
          <OptionAvatar option={current} size="button" />
          <Chevron className={styles.chevron} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={styles.menu}
          aria-label={copy.menu}
          aria-labelledby={undefined}
        >
          <DropdownMenuRadioGroup value={current.id} onValueChange={wrap(onChoose)}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id} className={styles.option}>
                <OptionAvatar option={option} size="menu" />
                <span className={styles.label}>{option.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className={styles.separator} />
          {manage.kind === 'open' ? (
            <DropdownMenuItem className={styles.manage} onSelect={wrap(onManage)}>
              {MANAGE_CATS_LABEL}
            </DropdownMenuItem>
          ) : (
            <p className={styles.hint}>{MANAGE_CATS_HINT}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  },
  'CatSwitcherMenu',
)

/**
 * The cat or litter switcher of a cat card's header (design `01 Дизайн-система`, section 06а).
 * One option is a plain avatar: no button, no chevron. Several open a menu of them.
 */
export const CatSwitcher = reatomMemo<CatSwitcherProps>((props) => {
  const { options, currentId, variant } = props
  const current = options.find((option) => option.id === currentId) ?? options[0]
  if (!current) return null

  if (variant === 'badge') {
    if (options.length < 2) return null
    return (
      <span className={styles.badge} title={current.label}>
        <OptionAvatar option={current} size="badge" />
      </span>
    )
  }

  // A cat card's lone avatar is the 26 px header size (06а, state A); a litter card's sits in the
  // smaller litter header at 22 px (page 05).
  if (options.length < 2) {
    return (
      <span className={styles.single}>
        <OptionAvatar option={current} size={props.kind === 'litter' ? 'menu' : 'header'} />
      </span>
    )
  }

  return <SwitcherMenu {...props} current={current} />
}, 'CatSwitcher')
