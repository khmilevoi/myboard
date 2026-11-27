import { wrap } from '@reatom/core'
import { CircleAlert, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import {
  type AvatarCropModel,
  type CropImage,
  imageLayout,
  MAX_ZOOM,
  MIN_ZOOM,
  type NudgeDirection,
  type Point,
} from '../files/avatar-crop-model'
import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog'

import styles from './AvatarCropDialog.module.css'

/** Draws one live preview of the current crop, `size` px across. */
export type RenderCropPreview = (size: number, testId: string) => ReactNode

export type AvatarCropDialogProps = {
  model: AvatarCropModel
  /** The dialog's heading, e.g. "Обрезать фото". */
  title: string
  /** The line under the heading that says what the crop is for. */
  hint: string
  /** The label above the preview row, e.g. "Так фото увидят другие". */
  previewTitle: string
  /**
   * The preview row's items. Each `renderPreview(size, testId)` is the current crop drawn at that
   * size, so the caller decides the sizes and captions and the crop math stays here.
   */
  previews: (renderPreview: RenderCropPreview) => ReactNode
  /** "Выбрать другой файл" in the unreadable state: reopens the caller's file picker. */
  onPickAnother: () => void
}

const ARROW_DIRECTIONS: Record<string, NudgeDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** Wheel sensitivity: one 100 px notch zooms by about 22 %. */
const WHEEL_ZOOM_RATE = 0.002
const WHEEL_LINE_PX = 16

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

const CropStage = reatomMemo<{ model: AvatarCropModel }>(({ model }) => {
  const stageRef = useRef<HTMLDivElement>(null)
  const hintId = useId()
  // Pointer bookkeeping is DOM interop: the model only ever sees pan/zoom deltas.
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; mid: Point } | null>(null)

  const layout = model.stageLayout()
  const image = model.image()
  const circle = model.circle()
  const saving = model.saving()

  // Bound during render so the native listeners below act in this component's Reatom context.
  const measure = wrap((width: number, height: number) => model.stage.set({ width, height }))
  const zoomAt = wrap((factor: number, anchor: Point) => model.zoomBy(factor, anchor))
  const handlers = useRef({ measure, zoomAt })
  handlers.current = { measure, zoomAt }

  useEffect(() => {
    const element = stageRef.current
    if (!element) return

    const update = () => {
      // jsdom (and a detached node) reports 0; keep the model's design-size default then.
      if (element.clientWidth > 0 && element.clientHeight > 0) {
        handlers.current.measure(element.clientWidth, element.clientHeight)
      }
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)

    // Native and non-passive: React's onWheel cannot preventDefault the page scroll.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY
      handlers.current.zoomAt(Math.exp(-delta * WHEEL_ZOOM_RATE), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      observer?.disconnect()
      element.removeEventListener('wheel', onWheel)
    }
  }, [])

  const relativeToCentre = (point: Point): Point => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 }
  }

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    pinch.current = a && b ? { distance: distance(a, b), mid: midpoint(a, b) } : null
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (saving || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) startPinch()
  }

  const onPointerMove = wrap((event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    const next = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, next)

    if (pointers.current.size === 1) {
      model.pan(next.x - previous.x, next.y - previous.y)
      return
    }

    const [a, b] = [...pointers.current.values()]
    const before = pinch.current
    if (!a || !b || !before) return
    const now = { distance: distance(a, b), mid: midpoint(a, b) }
    // Zoom about where the fingers were, then follow the fingers' midpoint.
    if (before.distance > 0)
      model.zoomBy(now.distance / before.distance, relativeToCentre(before.mid))
    model.pan(now.mid.x - before.mid.x, now.mid.y - before.mid.y)
    pinch.current = now
  })

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (pointers.current.size === 2) startPinch()
    else pinch.current = null
  }

  const onKeyDown = wrap((event: KeyboardEvent<HTMLDivElement>) => {
    if (saving) return
    const direction = ARROW_DIRECTIONS[event.key]
    if (direction) {
      event.preventDefault()
      model.nudge(direction, event.shiftKey)
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      model.stepZoom(1)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      model.stepZoom(-1)
    }
  })

  return (
    <div
      ref={stageRef}
      className={cn(styles.stage, saving && styles.stageLocked)}
      role="group"
      aria-roledescription="область обрезки"
      aria-label={
        saving
          ? 'Область обрезки заблокирована во время сохранения'
          : 'Область обрезки: круг поверх фото'
      }
      aria-describedby={hintId}
      aria-disabled={saving || undefined}
      tabIndex={saving ? -1 : 0}
      data-testid="avatar-crop-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {image && layout ? (
        <img
          className={styles.stageImage}
          src={image.url}
          alt=""
          draggable={false}
          data-testid="avatar-crop-image"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${layout.left}px, ${layout.top}px)`,
          }}
        />
      ) : null}
      <div className={styles.circle} style={{ width: circle, height: circle }} aria-hidden />
      <span id={hintId} className={styles.visuallyHidden}>
        Перетащите фото или двигайте его стрелками, с Shift — быстрее. Плюс и минус меняют масштаб.
      </span>
    </div>
  )
}, 'CropStage')

const CropPreview = reatomMemo<{
  image: CropImage
  side: number
  center: Point
  size: number
  testId: string
}>(({ image, side, center, size, testId }) => {
  const layout = imageLayout({
    image,
    side,
    center,
    box: { width: size, height: size },
    circle: size,
  })
  return (
    <span className={styles.preview} style={{ width: size, height: size }} aria-hidden>
      <img
        className={styles.previewImage}
        src={image.url}
        alt=""
        data-testid={testId}
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${layout.left}px, ${layout.top}px)`,
        }}
      />
    </span>
  )
}, 'CropPreview')

/** One captioned item of the preview row: a preview (or a line holding one) above its caption. */
export const AvatarCropPreviewItem = reatomMemo<{ caption: string; children: ReactNode }>(
  ({ caption, children }) => (
    <div className={styles.previewItem}>
      {children}
      <span className={styles.previewCaption}>{caption}</span>
    </div>
  ),
  'AvatarCropPreviewItem',
)

const CropPreviews = reatomMemo<{
  model: AvatarCropModel
  title: string
  previews: AvatarCropDialogProps['previews']
}>(({ model, title, previews }) => {
  const image = model.image()
  if (!image) return null
  const side = model.side()
  const center = model.center()
  const renderPreview: RenderCropPreview = (size, testId) => (
    <CropPreview image={image} side={side} center={center} size={size} testId={testId} />
  )

  return (
    <>
      <div className={styles.sectionLabel}>{title}</div>
      <div className={styles.previews}>{previews(renderPreview)}</div>
    </>
  )
}, 'CropPreviews')

export const AvatarCropDialog = reatomMemo<AvatarCropDialogProps>(
  ({ model, title, hint, previewTitle, previews, onPickAnother }) => {
    const open = model.open()
    const phase = model.phase()
    const saving = model.saving()
    const error = model.error()
    const zoom = model.zoom()
    const unreadable = phase === 'unreadable'
    const ready = phase === 'ready'

    // Every dismissal the user can trigger is refused while the upload runs.
    const guardWhileSaving = (event: Event) => {
      if (saving) event.preventDefault()
    }

    return (
      <Dialog
        open={open}
        onOpenChange={wrap((next: boolean) => {
          if (!next) model.close()
        })}
      >
        <DialogContent
          className={styles.content}
          overlayClassName={styles.overlay}
          data-testid="avatar-crop-dialog"
          aria-busy={saving || undefined}
          onEscapeKeyDown={guardWhileSaving}
          onPointerDownOutside={guardWhileSaving}
          onInteractOutside={guardWhileSaving}
        >
          <div className={styles.header}>
            <div>
              <DialogTitle className={styles.title}>{title}</DialogTitle>
              <DialogDescription className={styles.subtitle}>{hint}</DialogDescription>
            </div>
            <DialogClose asChild>
              <button type="button" aria-label="Закрыть" className={styles.close} disabled={saving}>
                <X size={16} strokeWidth={2} aria-hidden />
              </button>
            </DialogClose>
          </div>

          {unreadable ? null : (
            <>
              <CropStage model={model} />
              <div className={styles.zoomRow}>
                <ZoomOut size={16} strokeWidth={1.9} className={styles.zoomIcon} aria-hidden />
                <label className={styles.zoomLabel}>
                  <span className={styles.visuallyHidden}>Масштаб</span>
                  <input
                    type="range"
                    className={styles.zoomSlider}
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.01}
                    value={zoom}
                    disabled={!ready || saving}
                    onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
                      model.zoomTo(Number(event.currentTarget.value)),
                    )}
                  />
                </label>
                <ZoomIn size={16} strokeWidth={1.9} className={styles.zoomIcon} aria-hidden />
              </div>
              <CropPreviews model={model} title={previewTitle} previews={previews} />
            </>
          )}

          {error ? (
            <div className={styles.error} role="alert" data-testid="avatar-crop-error">
              <CircleAlert size={15} strokeWidth={2} className={styles.errorIcon} aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}

          <div className={cn(styles.actions, error && styles.actionsAfterError)}>
            <DialogClose asChild>
              <button type="button" className={styles.cancelButton} disabled={saving}>
                Отмена
              </button>
            </DialogClose>
            {unreadable ? (
              <button
                type="button"
                className={styles.primaryButton}
                data-testid="avatar-crop-pick-another"
                onClick={onPickAnother}
              >
                Выбрать другой файл
              </button>
            ) : (
              <button
                type="button"
                className={cn(styles.primaryButton, saving && styles.primaryButtonBusy)}
                disabled={!ready || saving}
                data-testid="avatar-crop-save"
                onClick={wrap(() => {
                  void model.save()
                })}
              >
                {saving ? (
                  <>
                    <span className={styles.spinner} aria-hidden />
                    Сохраняем…
                  </>
                ) : (
                  'Сохранить'
                )}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  },
  'AvatarCropDialog',
)
