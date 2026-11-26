import { notify } from '@reatom/core'
import {
  AlertCircle,
  Camera,
  Check,
  Globe,
  Loader2,
  Lock,
  QrCode,
  ShieldCheck,
  TimerOff,
  WifiOff,
  X,
} from 'lucide-react'
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react'
import { useState } from 'react'
import { useZxing } from 'react-zxing'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  type AddDeviceModel,
  CAMERA_DENIED_MESSAGE,
  type ScannerCamera,
  type ScanStatus,
} from '../model/add-device-model'
import { activateRoute, closeScan } from '../model/routes'
import { tuneScannerTrack } from '../model/scanner-camera'

import styles from './AddDeviceScreen.module.css'
import shellStyles from './shell.module.css'

export type AddDeviceScreenProps = {
  model: AddDeviceModel
}

// View-only formatting for the manual code field (uppercase, strip
// separators, group as XXXX-XXXX) -- distinct from the model's
// `extractAddCode`/`normalizeAddCode`, which validate and normalize a
// finished code rather than format one as the user is still typing it.
function formatManualCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

function passkeyButtonContent(loading: boolean) {
  if (loading) {
    return (
      <>
        <Loader2 size={18} strokeWidth={2} className="animate-spin" aria-hidden />
        Создаём passkey…
      </>
    )
  }
  return (
    <>
      <ShieldCheck size={18} strokeWidth={2} aria-hidden />
      Создать passkey
    </>
  )
}

type ScannerVideoProps = {
  constraints: MediaStreamConstraints
  onDecode: (rawValue: string) => void
  onCameraError: () => void
}

// `?camdebug` on the scanner URL prints which camera opened and at what size:
// the only way to see, on the phone itself, what the browser actually chose.
const CAMERA_DEBUG =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('camdebug')

// Mounted only once the model has chosen the camera, so `useZxing` opens that
// device directly instead of opening the default lens first.
function ScannerVideo({ constraints, onDecode, onCameraError }: ScannerVideoProps) {
  // Never `paused`: react-zxing stops the camera stream when paused, which
  // would black out the preview behind the feedback panel. The model ignores
  // decodes while a check or a panel is up instead (`stageScannedCode`).
  const { ref: videoRef } = useZxing({
    constraints,
    onDecodeResult: (result) => onDecode(result.rawValue),
    onError: onCameraError,
  })
  const [debugInfo, setDebugInfo] = useState('')

  // DOM interop: the opened track is only reachable through the element.
  function handleLoadedMetadata() {
    const video = videoRef.current
    const track =
      video?.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : null
    if (!video || !track) return
    void tuneScannerTrack(track).then(() => {
      if (!CAMERA_DEBUG) return
      const settings = track.getSettings() as MediaTrackSettings & {
        zoom?: number
        focusMode?: string
      }
      setDebugInfo(
        [
          track.label,
          `${video.videoWidth}×${video.videoHeight}`,
          settings.zoom !== undefined ? `zoom ${settings.zoom}` : '',
          settings.focusMode ?? '',
        ]
          .filter(Boolean)
          .join(' · '),
      )
    })
  }

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        className={styles.scannerOverlayVideo}
      />
      {debugInfo ? <p className={styles.scannerDebug}>{debugInfo}</p> : null}
    </>
  )
}

type ScannerOverlayProps = {
  camera: ScannerCamera
  status: ScanStatus
  onDecode: (rawValue: string) => void
  onCameraError: () => void
  onClose: () => void
  onResume: () => void
  onRetry: () => void
  onManual: () => void
}

type ScanSheetProps = {
  tone: 'warning' | 'danger' | 'neutral'
  icon: ReactNode
  title: string
  description: string
  primaryLabel: string
  onPrimary: () => void
  onManual: () => void
}

// The panel that replaces the hint when a scanned code cannot be used (design
// 4(b4)-4(b6)). The live preview keeps running behind it, so "Сканировать
// снова" is instant.
function ScanSheet({
  tone,
  icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  onManual,
}: ScanSheetProps) {
  return (
    <div role="alert" className={styles.scanSheet}>
      <div aria-hidden className={`${styles.scanSheetIcon} ${styles[`scanSheetIcon_${tone}`]}`}>
        {icon}
      </div>
      <p className={styles.scanSheetTitle}>{title}</p>
      <p className={styles.scanSheetDescription}>{description}</p>
      <Button
        type="button"
        className="h-11 w-full rounded-[12px] text-[14.5px] font-semibold"
        onClick={onPrimary}
      >
        {primaryLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        className={`h-11 w-full rounded-[12px] text-[14.5px] font-semibold ${styles.scanSheetSecondary}`}
        onClick={onManual}
      >
        Ввести код вручную
      </Button>
    </div>
  )
}

const SCAN_HINT = 'Наведите камеру на QR-код из окна «Добавить устройство»'

// Full-screen camera overlay from Activate.dc.html. A separate component (not a
// branch inside AddDeviceScreen) so `useZxing` — and the wasm barcode engine it
// eagerly loads — only mounts once the user actually reaches the scanner.
function ScannerOverlay({
  camera,
  status,
  onDecode,
  onCameraError,
  onClose,
  onResume,
  onRetry,
  onManual,
}: ScannerOverlayProps) {
  const sheet =
    status.kind === 'other-origin' ? (
      <ScanSheet
        tone="warning"
        icon={<Globe size={17} strokeWidth={2} />}
        title="QR-код с другого адреса"
        description={`Он создан на ${status.codeHost}, а вы на ${status.currentHost}. Откройте добавление устройства на том же адресе, где создан код.`}
        primaryLabel="Сканировать снова"
        onPrimary={onResume}
        onManual={onManual}
      />
    ) : status.kind === 'rejected' ? (
      <ScanSheet
        tone="danger"
        icon={<TimerOff size={17} strokeWidth={2} />}
        title="Код не подходит"
        description="Он истёк (код действует 5 минут), уже использован или неверный. Создайте новый QR-код на устройстве, где вы вошли."
        primaryLabel="Сканировать снова"
        onPrimary={onResume}
        onManual={onManual}
      />
    ) : status.kind === 'network' ? (
      <ScanSheet
        tone="neutral"
        icon={<WifiOff size={17} strokeWidth={2} />}
        title="Не удалось проверить код"
        description="Нет связи с сервером. Проверьте интернет и попробуйте ещё раз."
        primaryLabel="Повторить"
        onPrimary={onRetry}
        onManual={onManual}
      />
    ) : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Сканирование QR-кода"
      className={styles.scannerOverlay}
    >
      {camera.kind === 'ready' ? (
        <ScannerVideo
          constraints={camera.constraints}
          onDecode={onDecode}
          onCameraError={onCameraError}
        />
      ) : null}
      <div
        aria-hidden
        className={`${styles.scannerFrame} ${status.kind === 'checking' ? styles.scannerFrameChecking : ''}`}
      >
        <div className={`${styles.scannerCorner} ${styles.scannerCornerTl}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerTr}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerBl}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerBr}`} />
      </div>
      <div className={styles.scannerTopBar}>
        <div className={styles.scannerTitle}>Сканирование QR-кода</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть сканер"
          className={styles.scannerClose}
        >
          <X size={17} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      {status.kind === 'checking' ? (
        <p role="status" className={`${styles.scanPill} ${styles.scanPillChecking}`}>
          <Loader2 size={14} strokeWidth={2.4} className="animate-spin" aria-hidden />
          Проверяем код…
        </p>
      ) : null}
      {status.kind === 'foreign' ? (
        <p role="status" className={`${styles.scanPill} ${styles.scanPillForeign}`}>
          <QrCode size={14} strokeWidth={2.2} aria-hidden />
          Это не QR-код myboard
        </p>
      ) : null}
      {sheet ?? (
        <p className={styles.scannerOverlayHint}>
          {status.kind === 'checking' ? `Код ${formatManualCode(status.code)}` : SCAN_HINT}
        </p>
      )}
    </div>
  )
}

export const AddDeviceScreen = reatomMemo<AddDeviceScreenProps>(({ model }) => {
  const mode = model.mode()
  const error = model.error()
  const ownerName = model.ownerName()
  const scanStatus = model.scanStatus()
  // Whether the WebAuthn ceremony is in flight (panel 4(d1) "ready" vs 4(d2)
  // "creating…"). Sourced from the model's `startRegistration` withAsync status
  // (see model.ceremonyPending) rather than tracked as React state here.
  const ceremonyPending = model.ceremonyPending()
  const [manualValue, setManualValue] = useState('')

  // True when this screen mounted straight into scanning (activation card →
  // /add-device?scan=1). Its close ✕ returns to the activation card; a scanner
  // entered from the add-device `choose` screen returns to `choose` instead.
  const [enteredScanDirectly] = useState(() => model.mode() === 'scanning')

  function closeScanner() {
    if (enteredScanDirectly) {
      // Return to wherever the scanner was opened from (recorded in
      // scanReturn), replacing the /add-device?scan=1 history entry so browser
      // Back does not reopen the scanner. Falls back to the home card only for
      // a true external deep-link with no in-app screen behind it.
      closeScan()
      notify()
      return
    }
    goToChoose()
  }

  const scanning = mode === 'scanning'
  const cameraDenied = scanning && error != null

  function goToChoose() {
    model.goToChoose()
    setManualValue('')
  }

  function goToManual() {
    model.goToManual()
    setManualValue('')
  }

  function submitCode(value: string) {
    void model.submitManual(value)
  }

  function createPasskey() {
    void model.startRegistration()
  }

  // "Уже вошли на этом устройстве? Войти с passkey" -- lets someone who landed
  // on the registering step (e.g. a stale/foreign add-device link) bail to the
  // ordinary login card instead of the only other option being to register a
  // brand-new device for that account.
  function goToLogin() {
    activateRoute.go({}, true)
    notify()
  }

  function handleCodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') submitCode(manualValue)
  }

  function handleCodePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text')
    const code = model.extractAddCode(text)
    if (!code) return
    event.preventDefault()
    setManualValue(formatManualCode(code))
    submitCode(code)
  }

  function handleDecode(rawValue: string) {
    // A decoded QR is not itself a user gesture -- unlike the manual/paste
    // path, we deliberately do NOT call `submitManual` (which would start
    // the WebAuthn ceremony) here. `stageScannedCode` validates the code
    // against the server (extracting it from the raw scanned text itself)
    // and, only once confirmed, lands on 4(d1)'s "Создать passkey" button
    // so the ceremony only ever starts from a real click. A foreign,
    // other-origin, rejected or unverifiable code is explained in place on
    // the overlay through `model.scanStatus` (design 4(b2)-4(b6)).
    void model.stageScannedCode(rawValue)
  }

  function handleCameraError() {
    model.reportCameraError()
  }

  const isExpiredError = mode === 'manual' && error != null && error.toLowerCase().includes('истёк')
  const showRegisterLoading = mode === 'registering' && ceremonyPending

  // Forces the "затухание + сдвиг на 10px, 320мс, var(--ease)" step
  // transition (section 5) to replay on every visually distinct state, not
  // just every `mode` change -- 'scanning' and 'registering' each have two
  // sub-looks that share one `mode` value.
  const stepKey = [
    mode,
    cameraDenied ? 'denied' : '',
    showRegisterLoading ? 'loading' : '',
    isExpiredError ? 'expired' : '',
  ].join('|')

  if (scanning && !cameraDenied) {
    // Reading `camera` connects it, which chooses and opens the camera only
    // while the scanner is on screen (same connection-bound pattern as `poll`).
    const camera = model.camera()
    return (
      <ScannerOverlay
        camera={camera}
        status={scanStatus}
        onDecode={handleDecode}
        onCameraError={handleCameraError}
        onClose={closeScanner}
        onResume={() => model.resumeScan()}
        onRetry={() => void model.retryScan()}
        onManual={goToManual}
      />
    )
  }

  // Connect the status poller only while the waiting screen is shown. Reading
  // `poll` here subscribes this component to it; the interval's lifetime is
  // bound to that connection (model.poll / withConnectHook), so leaving
  // 'waiting' or unmounting stops polling automatically.
  if (mode === 'waiting') model.poll()

  return (
    <div key={stepKey} className={styles.stepContent}>
      {mode === 'choose' ? (
        <>
          <h1 className={styles.heading}>Добавить это устройство</h1>
          <p className={styles.description}>
            Отсканируйте QR-код или введите код с другого устройства
          </p>

          <Button
            type="button"
            className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonTopGap}`}
            onClick={model.goToScan}
          >
            <Camera size={18} strokeWidth={2} aria-hidden />
            Сканировать QR-код
          </Button>

          <div className={styles.divider}>
            <div className={styles.dividerLine} />
            <span className={styles.dividerLabel}>или</span>
            <div className={styles.dividerLine} />
          </div>

          <div className={styles.codeField}>
            <Input
              type="text"
              placeholder="____ – ____"
              aria-label="Код с другого устройства"
              aria-invalid={Boolean(error)}
              value={manualValue}
              className={`h-12 rounded-[13px] px-[15px] ${styles.codeInput}`}
              onChange={(event) => setManualValue(formatManualCode(event.target.value))}
              onPaste={handleCodePaste}
              onKeyDown={handleCodeKeyDown}
            />
            {error ? (
              <p role="alert" className={styles.codeErrorRow}>
                <AlertCircle size={13} strokeWidth={2.2} aria-hidden />
                {error}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            className={`h-12 w-full rounded-[13px] font-semibold ${styles.primaryButtonManualGap}`}
            onClick={() => submitCode(manualValue)}
          >
            Продолжить
          </Button>

          <div className={shellStyles.footerNote}>
            <Lock size={12} strokeWidth={2} aria-hidden />
            Защищено passkey на этом устройстве
          </div>
        </>
      ) : null}

      {cameraDenied ? (
        <>
          <div className={styles.cameraDeniedIcon}>
            <Camera size={24} strokeWidth={2} aria-hidden />
            <svg
              className={styles.cameraDeniedSlash}
              width="52"
              height="52"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                d="M4 4l16 16"
                stroke="var(--destructive)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className={styles.statusHeading}>Нет доступа к камере</h1>
          <p className={styles.statusDescription}>{CAMERA_DENIED_MESSAGE}</p>
          <Button
            type="button"
            variant="link"
            className="mt-4 h-auto p-0 text-sm font-semibold"
            onClick={closeScanner}
          >
            Назад
          </Button>
        </>
      ) : null}

      {mode === 'manual' ? (
        <>
          <h1 className={styles.manualHeading}>Введите код с другого устройства</h1>

          <div className={`${styles.codeField} ${styles.codeFieldWithMargin}`}>
            <Input
              type="text"
              placeholder="____ – ____"
              aria-label="Код с другого устройства"
              aria-invalid={Boolean(error)}
              value={manualValue}
              disabled={isExpiredError}
              className={`h-12 rounded-[13px] px-[15px] ${styles.codeInput} ${
                isExpiredError ? styles.codeInputExpired : ''
              }`}
              onChange={(event) => setManualValue(formatManualCode(event.target.value))}
              onPaste={handleCodePaste}
              onKeyDown={handleCodeKeyDown}
            />
            {error ? (
              <p role="alert" className={styles.codeErrorRow}>
                <AlertCircle size={13} strokeWidth={2.2} aria-hidden />
                {error}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            disabled={isExpiredError}
            className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonManualGap}`}
            onClick={() => submitCode(manualValue)}
          >
            Продолжить
          </Button>
        </>
      ) : null}

      {mode === 'registering' ? (
        <>
          <h1 className={styles.registerHeading}>
            {ownerName
              ? `Добавить устройство в аккаунт «${ownerName}»?`
              : 'Добавить устройство в аккаунт?'}
          </h1>
          <p className={styles.description}>Создайте passkey, чтобы завершить</p>

          <Button
            type="button"
            disabled={showRegisterLoading}
            aria-busy={showRegisterLoading}
            className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonTopGap}`}
            onClick={createPasskey}
          >
            {passkeyButtonContent(showRegisterLoading)}
          </Button>

          {error ? (
            <p role="alert" className={styles.codeErrorRow}>
              <AlertCircle size={13} strokeWidth={2.2} aria-hidden />
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={showRegisterLoading}
            onClick={goToLogin}
            className={styles.crossLink}
          >
            Уже вошли на этом устройстве?{' '}
            <span className={styles.crossLinkAccent}>Войти с passkey</span>
          </button>

          <div className={shellStyles.footerNote}>
            <Lock size={12} strokeWidth={2} aria-hidden />
            Защищено passkey на этом устройстве
          </div>
        </>
      ) : null}

      {mode === 'waiting' ? (
        <>
          <span aria-hidden className={styles.spinnerLarge} />
          <h1 className={`${styles.statusHeading} ${styles.statusHeadingLoose}`}>
            Ожидаем подтверждения
          </h1>
          <p className={styles.statusDescription}>
            Подтвердите это устройство на основном устройстве
          </p>
        </>
      ) : null}

      {mode === 'done' ? (
        <>
          <div className={`${styles.statusIcon} ${styles.statusIconSuccess}`}>
            <Check size={24} strokeWidth={2.4} aria-hidden />
          </div>
          <h1 className={`${styles.statusHeading} ${styles.statusHeadingLoose}`}>
            Готово. Перенаправляем…
          </h1>
        </>
      ) : null}

      {mode === 'rejected' ? (
        <>
          <div className={`${styles.statusIcon} ${styles.statusIconDanger}`}>
            <X size={24} strokeWidth={2} aria-hidden />
          </div>
          <h1 className={`${styles.statusHeading} ${styles.statusHeadingLoose}`}>
            Запрос отклонён
          </h1>
          <p className={styles.statusDescription}>Основное устройство отклонило подключение</p>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-[13px] font-semibold"
            onClick={goToChoose}
          >
            Попробовать снова
          </Button>
        </>
      ) : null}
    </div>
  )
}, 'AddDeviceScreen')
