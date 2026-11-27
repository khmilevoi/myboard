// @vitest-environment jsdom
import { context } from '@reatom/core'
import {
  CONSENT_CODE_DIGITS,
  PAIRING_PIN_DIGITS,
  SCALE_USER_SLOTS,
} from '@shared/hardware/spike-assumptions'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addInstance } from '@/board/model/board-model'
import { findWidgetType } from '@/widget-registry/model/registry'

import { formatSlotsFull, formatSlotsUpTo } from '../model/hardware-format'
import { WEIGHT_WIDGET_TYPE_ID } from '../model/hardware-session'
import {
  makeFakeWizardModel,
  makeGateway,
  makeHardware,
  makeSnapshot,
  makeTestHardwareModel,
  TEST_ADDRESS,
  type FakeWizardState,
} from '../model/testing'
import { HardwareDialog } from './HardwareDialog'
import { WizardView } from './WizardView'

vi.mock('@/board/model/board-model', () => ({ addInstance: vi.fn() }))

beforeEach(() => {
  context.reset()
  vi.mocked(addInstance).mockReset()
})

const scanResult = {
  address: TEST_ADDRESS,
  name: 'BF950',
  rssi: -60,
  model: 'beurer-bf950' as const,
}
const scanSnapshot = makeSnapshot([
  makeGateway({ scan: { active: true, startedAt: 0, results: [scanResult] } }),
])
const pairedSnapshot = makeSnapshot(
  [makeGateway()],
  [
    makeHardware({
      profiles: [
        { index: 1, binding: 'none' },
        { index: 2, binding: 'other' },
      ],
    }),
  ],
)
const PROFILE = { heightCm: 182, birthDate: '1992-03-14', sex: 'male' as const }
const pairing = (stage: 'connecting' | 'pin_required' | 'pin_rejected', pairingId: string | null) =>
  ({ kind: 'pairing', address: TEST_ADDRESS, pairingId, stage, startedAt: 0 }) as const

function renderWizard(state: FakeWizardState, snapshot = pairedSnapshot, hold: string[] = []) {
  const { model: hardware } = makeTestHardwareModel(snapshot)
  const fake = makeFakeWizardModel(state, hold)
  const callbacks = { onAddWeightCard: vi.fn(), onDone: vi.fn(), onClose: vi.fn() }
  render(<WizardView wizard={fake.model} hardware={hardware} {...callbacks} />)
  return { ...fake, hardware, ...callbacks }
}

const stepper = () => screen.getByTestId('hardware-wizard-stepper')

describe('WizardView scan (§4 a, a2)', () => {
  it('(a) wake-up copy, a found scale row with «Выбрать», «Ищем…» and stage 1', async () => {
    const { called } = renderWizard({ scanning: true, results: [scanResult] }, scanSnapshot)

    expect(screen.getByText(/Встаньте на весы, чтобы они проснулись/)).toBeInTheDocument()
    const row = screen.getByTestId(`hardware-scan-${TEST_ADDRESS}`)
    expect(row).toHaveTextContent('Beurer BF 950')
    expect(row).toHaveTextContent('весы · сигнал хороший')
    expect(screen.getByRole('status')).toHaveTextContent('Ищем…')
    expect(stepper()).toHaveAttribute('aria-label', 'Шаг 1 из 3')
    expect(within(stepper()).getByText('Поиск')).toHaveAttribute('data-state', 'now')
    expect(screen.getByTestId('hardware-wizard')).toHaveAttribute('data-step', 'scan')

    fireEvent.click(within(row).getByRole('button', { name: 'Выбрать' }))
    await waitFor(() => expect(called('choose')).toEqual([[TEST_ADDRESS]]))
  })

  it('(a) shows «Ищем…» while the scan start request is still out', async () => {
    const { model } = renderWizard({ scanning: false }, scanSnapshot, ['openScan'])
    expect(screen.queryByRole('status')).toBeNull()

    void model.openScan('g1')

    expect(await screen.findByRole('status')).toHaveTextContent('Ищем…')
  })

  it('(a2) nothing found: «Весы не нашлись» and «Искать ещё раз» rescans', async () => {
    const { called } = renderWizard({ nothingFound: true }, scanSnapshot)

    expect(screen.getByText('Весы не нашлись')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Искать ещё раз' }))
    await waitFor(() => expect(called('rescan')).toHaveLength(1))
  })
})

describe('WizardView pairing (§4 b, b2, b3)', () => {
  it('(b) PIN input; «Сопрячь» disabled while connecting with «Подключаемся к весам…»', () => {
    renderWizard({ step: pairing('connecting', null) }, scanSnapshot)

    const input = screen.getByLabelText('Код с экрана весов')
    expect(input).toHaveAttribute('maxLength', String(PAIRING_PIN_DIGITS))
    expect(input).toHaveAttribute('inputMode', 'numeric')
    expect(input).toHaveAttribute('autoComplete', 'one-time-code')
    expect(screen.getByText('Подключаемся к весам…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сопрячь' })).toBeDisabled()
    expect(within(stepper()).getByText('Поиск')).toHaveAttribute('data-state', 'done')
    expect(within(stepper()).getByText('Сопряжение')).toHaveAttribute('data-state', 'now')
  })

  it('(b) a full PIN while the gateway asks for it enables «Сопрячь», which submits', async () => {
    const { called, model } = renderWizard(
      { step: pairing('pin_required', 'p1'), pinEnabled: true },
      scanSnapshot,
    )

    fireEvent.change(screen.getByLabelText('Код с экрана весов'), {
      target: { value: '1'.repeat(PAIRING_PIN_DIGITS) },
    })
    expect(model.pin()).toBe('1'.repeat(PAIRING_PIN_DIGITS))
    const pair = screen.getByRole('button', { name: 'Сопрячь' })
    await waitFor(() => expect(pair).toBeEnabled())
    fireEvent.click(pair)
    await waitFor(() => expect(called('submitPin')).toHaveLength(1))
  })

  it('(b) a failed PIN submit shows the action error', () => {
    renderWizard(
      { step: pairing('pin_required', 'p1'), pinEnabled: true, actionError: 'Шлюз не в сети.' },
      scanSnapshot,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Шлюз не в сети.')
  })

  it('(b2) a rejected PIN marks the input', () => {
    renderWizard({ step: pairing('pin_rejected', 'p1'), pinEnabled: true }, scanSnapshot)

    expect(
      screen.getByText('Код не подошёл. Весы покажут новый — введите его.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Код с экрана весов')).toHaveAttribute('aria-invalid', 'true')
  })

  it('(b3) pairing failed: «Начать заново» restarts the scan on the same gateway', async () => {
    const { called } = renderWizard({ step: { kind: 'pairingFailed' } }, scanSnapshot)

    expect(screen.getByText('Сопряжение не удалось')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }))
    await waitFor(() => expect(called('openScan')).toEqual([['g1']]))
  })
})

describe('WizardView profile choice (§4 c, c5)', () => {
  it('(c) both options, the create summary from the health profile and the slots copy', async () => {
    const { called } = renderWizard({
      step: { kind: 'profileChoice', hardwareId: 'h1', slotsFull: false },
      healthProfile: PROFILE,
    })

    expect(screen.getByText(new RegExp(formatSlotsUpTo().toLowerCase()))).toBeInTheDocument()
    const create = screen.getByRole('button', { name: /Создать новый профиль/ })
    expect(create).toHaveAttribute('aria-pressed', 'true')
    expect(create).toHaveTextContent(
      /рост 182 см · \d+ (год|года|лет) · мужской — из вашего профиля/,
    )
    expect(screen.getByRole('button', { name: /Подключить существующий/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(within(stepper()).getByText('Профиль')).toHaveAttribute('data-state', 'now')

    fireEvent.click(screen.getByRole('button', { name: 'Создать профиль' }))
    await waitFor(() => expect(called('create')).toHaveLength(1))
  })

  it('(c) choosing «Подключить существующий» makes the primary «Дальше» → openAttach', () => {
    const { called } = renderWizard({
      step: { kind: 'profileChoice', hardwareId: 'h1', slotsFull: false },
    })

    fireEvent.click(screen.getByRole('button', { name: /Подключить существующий/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))
    expect(called('openAttach')).toHaveLength(1)
    expect(called('create')).toHaveLength(0)
  })

  it('(c5) all slots taken: create disabled with the count, primary «Дальше»', () => {
    renderWizard({ step: { kind: 'profileChoice', hardwareId: 'h1', slotsFull: true } })

    const create = screen.getByRole('button', { name: /Создать новый профиль/ })
    expect(create).toBeDisabled()
    expect(create).toHaveTextContent(formatSlotsFull())
    expect(create).toHaveTextContent(String(SCALE_USER_SLOTS))
    expect(screen.getByRole('button', { name: /Подключить существующий/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Дальше' })).toBeEnabled()
  })

  it('(c) the primary is disabled while create is sending', async () => {
    renderWizard(
      { step: { kind: 'profileChoice', hardwareId: 'h1', slotsFull: false } },
      pairedSnapshot,
      ['create'],
    )
    const primary = screen.getByRole('button', { name: 'Создать профиль' })
    fireEvent.click(primary)
    await waitFor(() => expect(primary).toBeDisabled())
  })
})

describe('WizardView attach (§4 c3, c4)', () => {
  const attachStep = (error: 'consent' | 'bound' | null = null, index: 1 | null = null) =>
    ({ kind: 'attach', hardwareId: 'h1', index, error }) as const

  it('(c3) free profile selectable, other-account profile disabled, consent input and hint', async () => {
    const { called, hardware } = renderWizard({ step: attachStep() })
    await waitFor(() => expect(hardware.snapshot.data()).not.toBeNull())

    const free = await screen.findByRole('button', { name: /Профиль 1/ })
    expect(free).toHaveTextContent('не привязан на этой борде')
    expect(free).toBeEnabled()
    const other = screen.getByRole('button', { name: /Профиль 2/ })
    expect(other).toHaveTextContent('привязан к другому аккаунту')
    expect(other).toBeDisabled()
    const input = screen.getByLabelText('Код согласия')
    expect(input).toHaveAttribute('maxLength', String(CONSENT_CODE_DIGITS))
    expect(input).toHaveAttribute('inputMode', 'numeric')
    expect(screen.getByText(/Его показали при создании профиля/)).toBeInTheDocument()

    fireEvent.click(free)
    expect(called('selectIndex')).toEqual([[1]])
  })

  it('(c3) «Подключить профиль» needs a selected profile and a full code', async () => {
    const { called } = renderWizard({ step: attachStep(null, 1) })

    const primary = screen.getByRole('button', { name: 'Подключить профиль' })
    expect(primary).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Код согласия'), {
      target: { value: '4'.repeat(CONSENT_CODE_DIGITS) },
    })
    await waitFor(() => expect(primary).toBeEnabled())
    fireEvent.click(primary)
    await waitFor(() => expect(called('attach')).toHaveLength(1))
  })

  it('(c4) the scale rejected the code', () => {
    renderWizard({ step: attachStep('consent', 1) })

    expect(screen.getByText(/Весы не приняли код/)).toBeInTheDocument()
    expect(screen.getByLabelText('Код согласия')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('WizardView scale answer (§4 c6, c7)', () => {
  it('(c6) writing: «Создаём профиль на весах», «Ждём ответ весов…»', () => {
    renderWizard({ step: { kind: 'writing', hardwareId: 'h1', mode: 'create', commandId: 'c1' } })

    expect(screen.getByText('Создаём профиль на весах')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Ждём ответ весов…')
  })

  it('(c7) silent scale: «Попробовать ещё раз» retries, «Назад» goes back', async () => {
    const { called } = renderWizard({
      step: { kind: 'scaleSilent', hardwareId: 'h1', mode: 'create' },
    })

    expect(screen.getByText('Весы не ответили')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(called('back')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    await waitFor(() => expect(called('retry')).toHaveLength(1))
  })
})

describe('WizardView done (§4 d, d2)', () => {
  const done = { kind: 'done', hardwareId: 'h1', index: 1, consentCode: '4821' } as const

  it('(d) code panel and «Готово»; no stepper', () => {
    const { onDone } = renderWizard({ step: done })

    expect(screen.getByText('Весы подключены')).toBeInTheDocument()
    expect(screen.getByText(/вес появится на карточке «Вес»/)).toBeInTheDocument()
    expect(screen.getByText('Код согласия · профиль 1')).toBeInTheDocument()
    expect(screen.getByTestId('hardware-wizard-code')).toHaveTextContent('4821')
    expect(screen.queryByTestId('hardware-wizard-stepper')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Добавить карточку «Вес»' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('(d2) no weight card: «Добавить карточку «Вес»» first, «Готово» second', () => {
    const { onAddWeightCard } = renderWizard({ step: done, boardNeedsWeightCard: true })

    expect(screen.getByText(/добавьте карточку «Вес»/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить карточку «Вес»' }))
    expect(onAddWeightCard).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Готово' })).toBeInTheDocument()
  })
})

describe('WizardView gateway offline (§4 e)', () => {
  it('overrides the step with «Шлюз не в сети», «Ждём шлюз…» and «Закрыть»', () => {
    const { onClose } = renderWizard(
      { step: pairing('pin_required', 'p1'), gatewayOffline: true },
      scanSnapshot,
    )

    expect(screen.getByTestId('hardware-wizard-offline')).toBeInTheDocument()
    expect(screen.getByText('Шлюз не в сети')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Ждём шлюз…')
    expect(screen.queryByLabelText('Код с экрана весов')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('HardwareDialog wizard view', () => {
  function renderDialog(state: FakeWizardState, hold: string[] = []) {
    const { model } = makeTestHardwareModel(pairedSnapshot)
    model.view.set('wizard')
    const fake = makeFakeWizardModel(state, hold)
    const onOpenChange = vi.fn()
    render(
      <HardwareDialog open onOpenChange={onOpenChange} model={model} wizardModel={fake.model} />,
    )
    return { model, onOpenChange, wizard: fake.model, called: fake.called }
  }

  it('titles: scan «Добавить оборудование», health form «Новый профиль», attach «Подключить профиль», others the model label', async () => {
    const { wizard } = renderDialog({ step: { kind: 'scan' } })
    expect(
      await screen.findByRole('heading', { name: 'Добавить оборудование' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull()

    wizard.step.set({ kind: 'healthForm', hardwareId: 'h1' })
    expect(await screen.findByRole('heading', { name: 'Новый профиль' })).toBeInTheDocument()

    wizard.step.set({ kind: 'attach', hardwareId: 'h1', index: null, error: null })
    expect(await screen.findByRole('heading', { name: 'Подключить профиль' })).toBeInTheDocument()

    wizard.step.set({ kind: 'profileChoice', hardwareId: 'h1', slotsFull: false })
    expect(await screen.findByRole('heading', { name: 'Beurer BF 950' })).toBeInTheDocument()
  })

  it('«Назад» in the header calls back, and is disabled while a profile command is sending', async () => {
    const { called, wizard } = renderDialog(
      { step: { kind: 'attach', hardwareId: 'h1', index: 1, error: null }, consent: '1234' },
      ['attach'],
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }))
    expect(called('back')).toHaveLength(1)

    void wizard.attach()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled())
  })

  it('«Назад» is disabled while the pairing request is out', async () => {
    const { wizard } = renderDialog({ step: pairing('connecting', null) }, ['choose'])

    const back = await screen.findByRole('button', { name: 'Назад' })
    expect(back).toBeEnabled()
    void wizard.choose(TEST_ADDRESS)
    await waitFor(() => expect(back).toBeDisabled())
  })

  it('(d2) «Добавить карточку «Вес»» adds the weight card and closes the dialog', async () => {
    const { onOpenChange, called } = renderDialog({
      step: { kind: 'done', hardwareId: 'h1', index: 1, consentCode: '4821' },
      boardNeedsWeightCard: true,
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить карточку «Вес»' }))

    expect(addInstance).toHaveBeenCalledWith(WEIGHT_WIDGET_TYPE_ID)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(called('close')).toHaveLength(1)
  })

  it('«Готово» returns to the list', async () => {
    const { model } = renderDialog({
      step: { kind: 'done', hardwareId: 'h1', index: 1, consentCode: '4821' },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }))

    expect(model.view()).toBe('list')
  })

  it('the list «Подключить профиль» opens the wizard on that scale’s profile choice', async () => {
    const { model } = makeTestHardwareModel(
      makeSnapshot([makeGateway()], [makeHardware({ profiles: [{ index: 1, binding: 'other' }] })]),
    )
    const fake = makeFakeWizardModel()
    render(<HardwareDialog open onOpenChange={vi.fn()} model={model} wizardModel={fake.model} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Подключить профиль' }))

    await waitFor(() => expect(fake.called('openProfile')).toEqual([['h1']]))
    expect(model.view()).toBe('wizard')
  })

  it('the list «Добавить оборудование» opens the scan on the online gateway', async () => {
    const { model } = makeTestHardwareModel(makeSnapshot([makeGateway({ id: 'g7' })]))
    const fake = makeFakeWizardModel()
    render(<HardwareDialog open onOpenChange={vi.fn()} model={model} wizardModel={fake.model} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить оборудование' }))

    await waitFor(() => expect(fake.called('openScan')).toEqual([['g7']]))
    expect(model.view()).toBe('wizard')
  })
})

describe('weight widget id', () => {
  it('WEIGHT_WIDGET_TYPE_ID resolves in the widget registry', () => {
    expect(findWidgetType(WEIGHT_WIDGET_TYPE_ID)).not.toBeInstanceOf(Error)
  })
})
