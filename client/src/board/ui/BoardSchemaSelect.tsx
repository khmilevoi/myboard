import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './BoardSchemaSelect.module.css'

export type BoardSchemaSelectItem = {
  id: string
  name: string
  isReadonly?: boolean
}

export type BoardSchemaSelectProps = {
  items: Array<BoardSchemaSelectItem>
  value: string | null
  isLoading?: boolean
  className?: string
  placeholder?: string
  onValueChange?: (id: string) => void
  onCreate?: (name: string) => void
  onRename?: (id: string, name: string) => void
  onDelete?: (id: string) => void
}

export const BoardSchemaSelect = reatomMemo<BoardSchemaSelectProps>(
  ({
    items,
    value,
    isLoading = false,
    className,
    placeholder = 'Выберите борду',
    onValueChange,
    onCreate,
    onRename,
    onDelete,
  }) => {
    const [open, setOpen] = React.useState(false)
    const [newName, setNewName] = React.useState('')
    const [editingId, setEditingId] = React.useState<string | null>(null)
    const [editingName, setEditingName] = React.useState('')

    const selectedItem = items.find((item) => item.id === value) ?? null
    const trimmedNewName = newName.trim()
    const trimmedEditingName = editingName.trim()

    const updateOpen = (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (nextOpen) return

      setEditingId(null)
      setEditingName('')
    }

    const submitNewName = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!trimmedNewName) return

      onCreate?.(trimmedNewName)
      setNewName('')
    }

    const startRename = (item: BoardSchemaSelectItem) => {
      setEditingId(item.id)
      setEditingName(item.name)
    }

    const submitRename = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!editingId || !trimmedEditingName) return

      onRename?.(editingId, trimmedEditingName)
      setEditingId(null)
      setEditingName('')
    }

    if (isLoading) {
      return (
        <Skeleton aria-label="Загрузка схем борды" className={cn(styles.skeleton, className)} />
      )
    }

    return (
      <Popover open={open} onOpenChange={updateOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(styles.trigger, className)}
            aria-label={selectedItem ? `Текущая схема: ${selectedItem.name}` : placeholder}
          >
            <span className={styles.triggerText}>{selectedItem?.name ?? placeholder}</span>
            <ChevronDown size={15} aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={10}
          className={styles.panel}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className={styles.head}>
            <span className={styles.headTitle}>Схемы борды</span>
            <span className={styles.headHint}>
              Выберите, добавьте, переименуйте или удалите схему
            </span>
          </div>

          {items.length > 0 ? (
            <ul className={styles.list}>
              {items.map((item) => {
                const isSelected = item.id === value
                const isEditing = item.id === editingId
                const canChangeItem = !item.isReadonly

                return (
                  <li key={item.id} className={styles.item}>
                    {isEditing ? (
                      <form className={styles.editForm} onSubmit={submitRename}>
                        <Input
                          value={editingName}
                          aria-label={`Новое имя схемы ${item.name}`}
                          onChange={(event) => setEditingName(event.target.value)}
                        />
                        <button
                          type="submit"
                          className={styles.formButton}
                          aria-label="Сохранить имя схемы"
                          disabled={!trimmedEditingName}
                        >
                          <Check size={15} aria-hidden />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={cn(styles.selectButton, isSelected && styles.selected)}
                          onClick={() => {
                            onValueChange?.(item.id)
                            setOpen(false)
                          }}
                        >
                          {isSelected ? (
                            <Check className={styles.check} size={15} aria-hidden />
                          ) : null}
                          <span className={styles.itemName}>{item.name}</span>
                        </button>
                        {onRename && canChangeItem ? (
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`Переименовать схему ${item.name}`}
                            onClick={() => startRename(item)}
                          >
                            <Pencil size={14} aria-hidden />
                          </button>
                        ) : null}
                        {onDelete && canChangeItem ? (
                          <button
                            type="button"
                            className={cn(styles.iconButton, styles.deleteButton)}
                            aria-label={`Удалить схему ${item.name}`}
                            onClick={() => onDelete(item.id)}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        ) : null}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className={styles.empty}>Схем пока нет</div>
          )}

          {onCreate ? (
            <form className={styles.form} onSubmit={submitNewName}>
              <Input
                value={newName}
                placeholder="Новая схема"
                aria-label="Название новой схемы"
                onChange={(event) => setNewName(event.target.value)}
              />
              <button
                type="submit"
                className={styles.formButton}
                aria-label="Добавить схему"
                disabled={!trimmedNewName}
              >
                <Plus size={16} aria-hidden />
              </button>
            </form>
          ) : null}
          <PopoverArrow className={styles.arrow} />
        </PopoverContent>
      </Popover>
    )
  },
  'BoardSchemaSelect',
)
