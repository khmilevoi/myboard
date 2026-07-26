import { ChevronDown, ChevronRight, CircleAlert, Copy } from 'lucide-react'
import { useState } from 'react'
import { cn, reatomMemo } from 'widget-sdk'

import styles from '../recovery-modal.module.css'

export const SshFallback = reatomMemo<{ sshTarget: string | null }>(({ sshTarget }) => {
  const [expanded, setExpanded] = useState(false)
  if (sshTarget === null) return null

  const command = `ssh -L 6080:127.0.0.1:6080 ${sshTarget}`
  const copy = () => {
    void navigator.clipboard.writeText(command).catch((cause: unknown) => {
      console.warn('clipboard write failed:', cause)
    })
  }

  return (
    <section className={styles.ssh}>
      <button
        type="button"
        className={cn(styles.sshToggle, expanded && styles.sshToggleExpanded)}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown className={styles.sshChevron} size={15} aria-hidden />
        ) : (
          <ChevronRight className={styles.sshChevron} size={15} aria-hidden />
        )}
        <span className={styles.sshLabel}>Запасной вход по SSH</span>
        <span className={styles.sshTag}>для продвинутых</span>
      </button>
      {expanded && (
        <div className={styles.sshBody}>
          <p className={styles.sshHint}>
            Если встроенное окно не работает, пробросьте noVNC по SSH и откройте
            http://localhost:6080 в браузере.
          </p>
          <div className={styles.sshCommandBlock}>
            <code className={styles.sshCommand}>
              <span className={styles.sshPrompt}>$ </span>
              {command}
            </code>
            <button
              type="button"
              className={styles.copyButton}
              onClick={copy}
              title="Скопировать"
              aria-label="Скопировать команду"
            >
              <Copy size={13} aria-hidden />
            </button>
          </div>
          <p className={styles.sshNote}>
            <CircleAlert className={styles.sshNoteIcon} size={12} aria-hidden />
            ssh-цель из конфигурации виджета · тот же одноразовый срок доступа
          </p>
        </div>
      )}
    </section>
  )
}, 'PassportCheckerSshFallback')
