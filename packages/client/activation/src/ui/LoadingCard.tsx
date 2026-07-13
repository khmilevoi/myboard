import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './shell.module.css'

// Card body shown by a route's `render` while its loader is not ready
// (only reached on the /add-device?token=CODE deep link while the embedded
// code is server-validated). The surrounding .page/.card come from Shell.
export const LoadingCard = reatomMemo(
  () => <span aria-hidden className={styles.spinnerLarge} />,
  'LoadingCard',
)
