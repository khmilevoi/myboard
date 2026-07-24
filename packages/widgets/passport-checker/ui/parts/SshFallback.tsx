import { Copy } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk'

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
        className={styles.sshToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Запасной вход по SSH</span>
        <span className={styles.sshTag}>для продвинутых</span>
      </button>
      {expanded && (
        <div className={styles.sshBody}>
          <p className={styles.sshHint}>
            Если встроенное окно не работает, пробросьте noVNC по SSH и откройте
            http://localhost:6080 в браузере.
          </p>
          <div className={styles.sshCommandRow}>
            <code className={styles.sshCommand}>{command}</code>
            <button
              type="button"
              className={styles.copyButton}
              onClick={copy}
              aria-label="Скопировать команду"
            >
              <Copy size={14} aria-hidden />
            </button>
          </div>
          <p className={styles.sshNote}>
            ssh-цель из конфигурации виджета · тот же одноразовый срок доступа
          </p>
        </div>
      )}
    </section>
  )
}, 'PassportCheckerSshFallback')
