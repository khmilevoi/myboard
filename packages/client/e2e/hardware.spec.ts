import { HardwarePage } from './pages/HardwarePage.js'
import { WeightPage } from './pages/WeightPage.js'
import { seedSession } from './support/gate.js'
import {
  bindProfileViaApi,
  connectGatewayViaApi,
  type FakeGatewayStream,
  e2ePairingPin,
  makeFakeGateway,
  pairViaApi,
  postGatewayEvents,
  SCALE_ADDRESS,
  scaleScanResult,
} from './support/hardware.js'
import { expect, test } from './support/test.js'

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  // Other specs pin the process-wide server clock; the gateway code's countdown, the scan window
  // and the weight card's period all read real time.
  await request.post('/api/test/time', { data: { ms: Date.now() } })
})

test('a fake gateway registers, pairs the scale, creates a profile and the weight card updates live', async ({
  page,
  stack,
}) => {
  // page.request shares the browser context's cookies: this session is the board's account.
  await seedSession(page.request)
  await page.goto('/')

  const hardware = new HardwarePage(page)
  await hardware.open()
  await expect(hardware.primary).toHaveText('Добавить шлюз')
  await hardware.primary.click()

  await expect(hardware.gatewayCode).toBeVisible()
  const code = (await hardware.gatewayCode.textContent())?.trim() ?? ''
  expect(code).not.toBe('')

  // Gateway routes need no session: the fake gateway talks to the worker's test-server directly.
  const gateway = makeFakeGateway(stack.apiURL)
  await gateway.register(code, 'Raspberry Pi')
  let stream: FakeGatewayStream | null = null
  try {
    stream = await gateway.openStream()

    await expect(hardware.addGateway).toHaveAttribute('data-phase', 'connected')
    await expect(hardware.dialog.getByText('Шлюз подключён')).toBeVisible()
    await hardware.button('Добавить оборудование').click()

    // §4(a): the scan reaches the gateway; its result shows up with «Выбрать».
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'scan')
    await stream.nextCommand('scan.start')
    await postGatewayEvents(gateway, [scaleScanResult()])
    await hardware.scanResult(SCALE_ADDRESS).getByRole('button', { name: 'Выбрать' }).click()

    // §4(b): the PIN from the scale's screen goes to the gateway as typed.
    const pair = await stream.nextCommand('pair')
    expect(pair.address).toBe(SCALE_ADDRESS)
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'pairing')
    await postGatewayEvents(gateway, [
      { type: 'pairing.progress', pairingId: pair.pairingId, stage: 'pin_required' },
    ])
    const typedPin = e2ePairingPin()
    await hardware.dialog.getByLabel('Код с экрана весов').fill(typedPin)
    await hardware.button('Сопрячь').click()
    const pin = await stream.nextCommand('pairing.pin')
    expect(pin.pin).toBe(typedPin)
    await postGatewayEvents(gateway, [
      { type: 'pairing.progress', pairingId: pair.pairingId, stage: 'bonded' },
    ])

    // §4(c) → §4(c2): a new profile, and the account has no health profile yet.
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'profileChoice')
    await hardware.dialog.getByTestId('hardware-wizard-option-create').click()
    await hardware.button('Создать профиль').click()
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'healthForm')
    await hardware.dialog.getByLabel('Рост, см').fill('182')
    await hardware.dialog.getByLabel('Дата рождения').fill('14.03.1992')
    await hardware.button('Мужской').click()
    await hardware.button('Сохранить и создать профиль').click()

    const create = await stream.nextCommand('scaleUser.create')
    expect(create.address).toBe(SCALE_ADDRESS)
    expect(create.profile).toEqual({ heightCm: 182, birthDate: '1992-03-14', sex: 'male' })
    await postGatewayEvents(gateway, [
      { type: 'scaleUser.created', commandId: create.id, index: 1 },
    ])

    // §4(d2): done, with the code the scale was given, and no weight card on the board yet.
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'done')
    await expect(hardware.dialog.getByText('Весы подключены')).toBeVisible()
    await expect(hardware.dialog.getByTestId('hardware-wizard-code')).toHaveText(create.consentCode)
    // The storage runtime reads a key and registers its live subscription in parallel, so a write
    // landing before the registration is answered is never delivered. Post the reading only once
    // the new card's subscription to the weight keys is registered on the server.
    const cardSubscribed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/storage/events/') &&
        (response.request().postData() ?? '').includes('latest/weight') &&
        response.ok(),
    )
    await hardware.button('Добавить карточку «Вес»').click()
    await expect(hardware.dialog).toHaveCount(0)

    const weight = new WeightPage(page)
    await expect(weight.card.emptyTitle).toBeVisible()
    await cardSubscribed

    // A reading of that scale profile reaches the new card over the live stream, no reload.
    const posted = await gateway.postReadings([
      {
        ref: 'e2e-1',
        hardwareId: create.hardwareId,
        scaleUserIndex: 1,
        takenAt: Date.now() - 3_600_000,
        metrics: { weight: { value: 83.4, unit: 'kg' } },
      },
    ])
    expect(posted.status).toBe(200)
    expect(await posted.json()).toEqual({ results: [{ ref: 'e2e-1', status: 'stored' }] })
    await expect(weight.card.value).toHaveText('83,4 кг')
  } finally {
    stream?.close()
  }
})

test('the API helpers pair and bind a scale the list then shows', async ({ page, stack }) => {
  await seedSession(page.request)
  const gateway = makeFakeGateway(stack.apiURL)
  const stream = await connectGatewayViaApi(page.request, gateway)
  try {
    const { hardwareId } = await pairViaApi(page.request, gateway, stream)
    const { index } = await bindProfileViaApi(page.request, gateway, stream, hardwareId)

    await page.goto('/')
    const hardware = new HardwarePage(page)
    await hardware.open()
    await expect(hardware.gatewayRow(gateway.gatewayId)).toBeVisible()
    await expect(hardware.hardwareRow(hardwareId)).toBeVisible()
    await expect(hardware.profileRow(index, hardwareId)).toBeVisible()
  } finally {
    stream.close()
  }
})
