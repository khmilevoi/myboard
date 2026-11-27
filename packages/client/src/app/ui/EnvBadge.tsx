import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Popover, PopoverContent, PopoverTrigger } from 'widget-sdk/ui/popover'

import type { AppBuildInfo } from '@/shared/app-env/build-info'
import { APP_ENVS, type AppEnvName } from '@/shared/app-env/registry'

import styles from './EnvBadge.module.css'

interface EnvBadgeProps {
  env: AppEnvName
  build?: AppBuildInfo
}

const UNKNOWN_BUILD: AppBuildInfo = { branch: null, commit: null }

/**
 * Which stack this board is, and -- in its popover -- which source it was
 * built from. Prop-driven on purpose: the environment and the build are
 * constants baked into the bundle, so an atom would model a variable that does
 * not exist, and props are what make it testable without touching the build.
 *
 * The pill reads the branch name on the `branch` stand (the one stand whose
 * label alone says nothing: it serves whichever branch was deployed last) and
 * the environment label everywhere else. A long branch name is cut with an
 * ellipsis by CSS; the popover always carries it in full. On a phone
 * (EnvBadge.module.css, ≤640px) the pill shrinks to its dot and the popover is
 * the only place the text lives.
 *
 * The popover's open state is Radix's own (uncontrolled): nothing outside
 * this component reads or drives it.
 *
 * Not built on widget-sdk/ui/badge.tsx: that is a Tailwind/cva shadcn
 * primitive whose variants all key off --primary/--secondary/--destructive,
 * and this pill needs --accent-soft plus --env-badge-fg, a token that exists
 * only inside the per-environment override -- which is exactly the case where
 * this renders at all.
 */
export const EnvBadge = reatomMemo<EnvBadgeProps>(({ env, build = UNKNOWN_BUILD }) => {
  const { label } = APP_ENVS[env]
  if (label === null) return null

  const branch = env === 'branch' ? build.branch : null
  const accessibleName = [`Окружение: ${label}`, build.branch && `ветка ${build.branch}`]
    .filter(Boolean)
    .join(', ')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={styles.badge} aria-label={accessibleName}>
          <span className={styles.dot} aria-hidden="true" />
          {branch ? (
            <span className={`${styles.label} ${styles.branch}`}>{branch}</span>
          ) : (
            <span className={styles.label}>{label}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className={styles.panel}>
        <div className={styles.panelTitle}>
          <span className={styles.dot} aria-hidden="true" />
          Окружение {label}
        </div>
        <dl className={styles.rows}>
          {build.branch && (
            <div className={styles.rowStacked}>
              <dt>Ветка</dt>
              <dd className={styles.mono}>{build.branch}</dd>
            </div>
          )}
          <div className={styles.row}>
            <dt>Коммит</dt>
            <dd className={styles.mono}>{build.commit ?? 'неизвестен'}</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  )
}, 'EnvBadge')
