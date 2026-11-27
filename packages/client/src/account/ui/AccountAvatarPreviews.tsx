import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { AvatarCropPreviewItem, type RenderCropPreview } from 'widget-sdk/ui/AvatarCropDialog'

import styles from './AccountAvatarPreviews.module.css'

export type AccountAvatarPreviewsProps = {
  renderPreview: RenderCropPreview
  /** The account's first name, for the widget-history preview line. */
  firstName: string
}

/** Where the account photo shows up: the menu, the header, a widget's history line. */
export const AccountAvatarPreviews = reatomMemo<AccountAvatarPreviewsProps>(
  ({ renderPreview, firstName }) => (
    <>
      <AvatarCropPreviewItem caption="Меню">
        {renderPreview(44, 'avatar-crop-preview-menu')}
      </AvatarCropPreviewItem>
      <AvatarCropPreviewItem caption="Хедер">
        {renderPreview(36, 'avatar-crop-preview-header')}
      </AvatarCropPreviewItem>
      <AvatarCropPreviewItem caption="История виджета">
        <div className={styles.historyLine}>
          {renderPreview(18, 'avatar-crop-preview-history')}
          <span className={styles.historyText}>{firstName} отметил(а) уборку</span>
        </div>
      </AvatarCropPreviewItem>
    </>
  ),
  'AccountAvatarPreviews',
)
