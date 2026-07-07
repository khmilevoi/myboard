import { AlertCircle, Camera, Check, Loader2, Lock, ShieldCheck, X } from 'lucide-react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { useState } from 'react'
import { useZxing } from 'react-zxing'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { type AddDeviceModel, createAddDeviceModel } from '../model/add-device-model'

import styles from './AddDeviceScreen.module.css'

export type AddDeviceScreenProps = {
  // Optional so the real route (App.tsx) can mount `<AddDeviceScreen />` with
  // no props (one model instance per mount, mirroring ActivateScreen's own
  // `useState(() => createActivationModel())`) while a test can still inject
  // a fake/spy-wrapped model instance.
  model?: AddDeviceModel
}

// react-zxing's `onError` fires when getUserMedia itself fails (permission
// denied, no camera, etc.) -- reused via the model's own generic `error`
// atom (panel 4(b2) "Нет доступа к камере") rather than a dedicated atom,
// since add-device-model.ts (C2) doesn't expose a separate camera-state
// field and `error` is already the shared "something went wrong for the
// current mode" slot (mirrors how it's reused across manual/registering/
// waiting failures).
const CAMERA_DENIED_MESSAGE =
  'Разрешите доступ к камере в настройках браузера или введите код вручную'

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

type ScannerProps = {
  onDecode: (rawValue: string) => void
  onCameraError: () => void
}

// A separate component (not a conditionally-skipped branch inside
// AddDeviceScreen) so `useZxing` -- and the barcode-detector wasm engine it
// eagerly loads as soon as it's called, regardless of any `paused` option --
// only ever mounts once the user actually picks "Сканировать QR-код".
// Mounting it unconditionally in AddDeviceScreen would start that wasm fetch
// on every visit to this screen (even for manual-code-only users) and
// crashes under jsdom (no real network/WebAssembly streaming there), which
// is exactly what an earlier draft of this component hit in
// AddDeviceScreen.test.tsx.
function Scanner({ onDecode, onCameraError }: ScannerProps) {
  const { ref: videoRef } = useZxing({
    onDecodeResult: (result) => onDecode(result.rawValue),
    onError: onCameraError,
  })

  return (
    <>
      <h1 className={styles.scanHeading}>Сканирование</h1>
      <div className={styles.scannerViewport}>
        <video ref={videoRef} muted playsInline className={styles.scannerVideo} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerTl}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerTr}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerBl}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerBr}`} />
        <div className={styles.scannerLine} />
      </div>
      <p className={styles.scannerHint}>Наведите камеру на QR-код</p>
    </>
  )
}

export const AddDeviceScreen = reatomMemo<AddDeviceScreenProps>(({ model: injectedModel }) => {
  const [model] = useState(() => injectedModel ?? createAddDeviceModel())
  const mode = model.mode()
  const error = model.error()
  const ownerName = model.ownerName()
  const [manualValue, setManualValue] = useState('')
  // Tracks whether the WebAuthn *ceremony itself* is currently in flight,
  // distinguishing panel 4(d1) "ready to create a passkey" from 4(d2)
  // "creating…" -- add-device-model.ts's `startRegistration` action has no
  // exposed pending flag of its own (unlike activation-model.ts's `loading`
  // computed), so this is plain view-local state around the two call sites
  // that trigger it (the manual/paste path's `submitManual`, which starts
  // the ceremony automatically, and the scan path's own "Создать passkey"
  // button, which starts it directly).
  const [ceremonyPending, setCeremonyPending] = useState(false)

  const scanning = mode === 'scanning'
  const cameraDenied = scanning && error != null

  function goToScan() {
    model.error.set(null)
    model.mode.set('scanning')
  }

  function goToManual() {
    model.error.set(null)
    model.mode.set('manual')
  }

  function goToChoose() {
    model.error.set(null)
    setManualValue('')
    model.mode.set('choose')
  }

  function submitCode(value: string) {
    setCeremonyPending(true)
    void model.submitManual(value).finally(() => setCeremonyPending(false))
  }

  function createPasskey() {
    setCeremonyPending(true)
    void model.startRegistration().finally(() => setCeremonyPending(false))
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
    // so the ceremony only ever starts from a real click. An unrecognized
    // or server-rejected code routes back to 4(c1)'s manual-entry screen
    // rather than stranding the user on 'registering'.
    void model.stageScannedCode(rawValue)
  }

  function handleCameraError() {
    model.error.set(CAMERA_DENIED_MESSAGE)
  }

  const isExpiredError = mode === 'manual' && error != null && error.toLowerCase().includes('истёк')
  const showRegisterLoading = mode === 'registering' && ceremonyPending
  const showBrandMark = mode !== 'scanning'

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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {showBrandMark ? (
          <>
            <div aria-hidden className={styles.brandMark}>
              <div className={styles.brandCell} />
              <div className={styles.brandCellDim} />
              <div className={styles.brandCellDim} />
              <div className={styles.brandCell} />
            </div>
            <div className={styles.brandLabel}>myboard</div>
          </>
        ) : null}

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
                onClick={goToScan}
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
                className="h-12 w-full rounded-[13px] font-semibold"
                onClick={() => submitCode(manualValue)}
              >
                Продолжить
              </Button>

              <div className={styles.footerNote}>
                <Lock size={12} strokeWidth={2} aria-hidden />
                Защищено passkey на этом устройстве
              </div>
            </>
          ) : null}

          {scanning && !cameraDenied ? (
            <Scanner onDecode={handleDecode} onCameraError={handleCameraError} />
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
                onClick={goToManual}
              >
                Ввести код вручную
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

              <div className={styles.footerNote}>
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
      </div>
    </div>
  )
}, 'AddDeviceScreen')
