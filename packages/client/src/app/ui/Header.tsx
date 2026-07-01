import { wrap } from '@reatom/core'
import { useMemo } from 'react'

import { addBoard, removeBoard, updateBoard } from '@/board/model/board-model'
import { activeBoardId, boards, LOCAL_BOARD_ID } from '@/board/model/board-storage'
import { AddWidgetMenu } from '@/board/ui/AddWidgetMenu'
import { BoardSchemaSelect } from '@/board/ui/BoardSchemaSelect'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { ThemeToggle } from '@/theme/ui/ThemeToggle'

import styles from './Header.module.css'

export const Header = reatomMemo(() => {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <span className={styles.logoMuted}>my</span>
          <span className={styles.logoStrong}>board</span>
        </span>
        <BoardSelect />
      </div>
      <div className={styles.actions}>
        <ThemeToggle />
        <AddWidgetMenu />
      </div>
    </header>
  )
}, 'Header')

export const BoardSelect = reatomMemo(() => {
  const boardItems = boards()
  const boardId = activeBoardId()

  const items = useMemo(() => {
    const remoteItems = boardItems?.map((board) => ({ id: board.id, name: board.name })) ?? []

    return [...remoteItems, { id: LOCAL_BOARD_ID, name: 'Локальная', isReadonly: true }]
  }, [boardItems])

  return (
    <BoardSchemaSelect
      items={items}
      value={boardId ?? null}
      onCreate={wrap((name) => addBoard(name))}
      onDelete={wrap((id) => removeBoard(id))}
      onValueChange={wrap((id) => activeBoardId.set(id))}
      onRename={wrap((id, name) => updateBoard(id, name))}
    />
  )
})
