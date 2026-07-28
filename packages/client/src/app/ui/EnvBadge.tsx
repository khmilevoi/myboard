import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { APP_ENVS, type AppEnvName } from '@/shared/app-env/registry'

import styles from './EnvBadge.module.css'

interface EnvBadgeProps {
  env: AppEnvName
}

/**
 * Which stack this board is. Prop-driven and stateless on purpose: the
 * environment is a build constant that cannot change at runtime, so an atom
 * would model a variable that does not exist -- and a prop is what makes the
 * component testable without touching the build.
 *
 * Not built on components/ui/badge.tsx: that is a Tailwind/cva shadcn
 * primitive whose variants all key off --primary/--secondary/--destructive,
 * and this pill needs --accent-soft plus --env-badge-fg, a token that exists
 * only inside the per-environment override -- which is exactly the case where
 * this renders at all. A CSS module is how the rest of the host chrome
 * (Header.module.css, App.module.css) is written.
 */
export const EnvBadge = reatomMemo<EnvBadgeProps>(({ env }) => {
  const { label } = APP_ENVS[env]
  if (label === null) return null

  return (
    <span className={styles.badge} role="status" aria-label={`Окружение: ${label}`}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  )
}, 'EnvBadge')
