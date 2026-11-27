import type { Locator } from '@playwright/test'

import { HardwarePage } from './pages/HardwarePage.js'
import { seedSession } from './support/gate.js'
import {
  bindProfileViaApi,
  connectGatewayViaApi,
  type FakeGateway,
  type FakeGatewayStream,
  makeFakeGateway,
  pairViaApi,
  postGatewayEvents,
  SCALE_ADDRESS,
  scaleScanResult,
} from './support/hardware.js'
import { expect, test } from './support/test.js'

const PHONE = { width: 375, height: 812 }

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  // Other specs pin the process-wide server clock; the gateway code's countdown and the scan
  // window read real time.
  await request.post('/api/test/time', { data: { ms: Date.now() } })
})

/** Waits for the next `bindings.sync` on `stream` that names the binding `hardwareId`/`index`. */
async function nextSyncNaming(stream: FakeGatewayStream, hardwareId: string, index: number) {
  // The stream-open sync (nothing attached yet) arrives first; skip syncs that do not name it.
  for (;;) {
    const sync = await stream.nextCommand('bindings.sync')
    const binding = sync.bindings.find(
      (item) => item.hardwareId === hardwareId && item.index === index,
    )
    if (binding !== undefined) return binding
  }
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('the element has no layout box')
  return box
}

test('offline: the window says so, blocks scale actions and still reveals and unbinds', async ({
  page,
  stack,
}) => {
  await seedSession(page.request)
  const gateway = makeFakeGateway(stack.apiURL)
  const stream = await connectGatewayViaApi(page.request, gateway)
  try {
    const { hardwareId } = await pairViaApi(page.request, gateway, stream)
    const { index, consentCode } = await bindProfileViaApi(
      page.request,
      gateway,
      stream,
      hardwareId,
    )

    await page.goto('/')
    const hardware = new HardwarePage(page)
    await hardware.open()
    await expect(hardware.gatewayRow(gateway.gatewayId)).toContainText('в сети')
    await expect(hardware.button('Отключить')).toBeVisible()

    // The server marks the gateway offline when its command stream closes.
    stream.close()

    await expect(hardware.gatewayRow(gateway.gatewayId)).toContainText('не в сети')
    await expect(hardware.dialog.getByTestId('hardware-offline-note')).toBeVisible()
    await expect(hardware.primary).toHaveText('Добавить оборудование')
    await expect(hardware.primary).toBeDisabled()
    await expect(hardware.dialog.getByTestId('hardware-primary-hint')).toBeVisible()
    await expect(hardware.hardwareRow(hardwareId)).toHaveAttribute('data-mode', 'attached')
    await expect(hardware.button('Отключить')).toHaveCount(0)

    // §2(d): the consent code and unbinding work without the gateway.
    const profile = hardware.profileRow(index, hardwareId)
    await profile.getByRole('button', { name: 'Код согласия', exact: true }).click()
    await expect(profile.getByTestId('hardware-code')).toHaveText(consentCode)
    await profile.getByTestId('hardware-code-hide').click()
    await expect(hardware.dialog.getByTestId('hardware-code')).toHaveCount(0)

    await profile.getByRole('button', { name: 'Отвязать', exact: true }).click()
    await expect(hardware.confirm).toHaveCount(1)
    await hardware.confirmOk.click()
    await expect(profile).toHaveCount(0)
    await expect(hardware.confirm).toHaveCount(0)
    await expect(hardware.hardwareRow(hardwareId)).toBeVisible()
  } finally {
    stream.close()
  }
})

test('revoke and return: a revoked gateway leaves the scale waiting, the same Pi brings it back', async ({
  page,
  stack,
}) => {
  await seedSession(page.request)
  const first = makeFakeGateway(stack.apiURL)
  const firstStream = await connectGatewayViaApi(page.request, first)
  let second: FakeGateway | null = null
  let secondStream: FakeGatewayStream | null = null
  try {
    const { hardwareId } = await pairViaApi(page.request, first, firstStream)
    const { index } = await bindProfileViaApi(page.request, first, firstStream, hardwareId)

    await page.goto('/')
    const hardware = new HardwarePage(page)
    await hardware.open()

    await hardware.gatewayRow(first.gatewayId).getByRole('button', { name: 'Отозвать' }).click()
    await expect(hardware.confirm).toHaveCount(1)
    await hardware.confirmOk.click()

    // §2(e2): no gateway; the scale and its profile wait on the board.
    await expect(hardware.gatewayRows).toHaveCount(0)
    await expect(hardware.dialog.getByRole('heading', { name: 'Ждут шлюз' })).toBeVisible()
    await expect(hardware.hardwareRow(hardwareId)).toHaveAttribute('data-mode', 'detached')
    await expect(hardware.primary).toHaveText('Добавить шлюз')

    // The same Pi comes back with a new code: a new gateway record that still holds the bond.
    await hardware.primary.click()
    await expect(hardware.gatewayCode).toBeVisible()
    const code = (await hardware.gatewayCode.textContent())?.trim() ?? ''
    expect(code).not.toBe('')
    second = makeFakeGateway(stack.apiURL)
    await second.register(code, 'Raspberry Pi')
    secondStream = await second.openStream()
    await expect(hardware.addGateway).toHaveAttribute('data-phase', 'connected')
    await postGatewayEvents(second, [
      { type: 'bonded', hardware: [{ address: SCALE_ADDRESS, model: 'beurer-bf950' }] },
    ])
    await hardware.button('Готово').click()

    // §2(e3): the scale is offered back to the gateway that remembers it.
    await expect(
      hardware.dialog.getByRole('heading', { name: 'Уже были на этой борде' }),
    ).toBeVisible()
    const row = hardware.hardwareRow(hardwareId)
    await expect(row).toHaveAttribute('data-mode', 'returnable')
    await row.getByRole('button', { name: 'Вернуть', exact: true }).click()

    await expect(hardware.dialog.getByRole('heading', { name: 'Подключено' })).toBeVisible()
    await expect(row).toHaveAttribute('data-mode', 'attached')
    await expect(hardware.profileRow(index, hardwareId)).toContainText(`Профиль ${index} · ваш`)
    await expect(
      hardware.dialog.getByRole('heading', { name: 'Уже были на этой борде' }),
    ).toHaveCount(0)

    // The returned gateway learns the binding it must route readings by.
    const binding = await nextSyncNaming(secondStream, hardwareId, index)
    expect(binding.address).toBe(SCALE_ADDRESS)
  } finally {
    firstStream.close()
    secondStream?.close()
  }
})

test('inline confirms open one at a time and cancel cleanly', async ({ page, stack }) => {
  await seedSession(page.request)
  const gateway = makeFakeGateway(stack.apiURL)
  const stream = await connectGatewayViaApi(page.request, gateway)
  try {
    const { hardwareId } = await pairViaApi(page.request, gateway, stream)
    const { index } = await bindProfileViaApi(page.request, gateway, stream, hardwareId)

    await page.goto('/')
    const hardware = new HardwarePage(page)
    await hardware.open()
    const scale = hardware.hardwareRow(hardwareId)
    const profile = hardware.profileRow(index, hardwareId)

    await scale.getByRole('button', { name: 'Отключить', exact: true }).click()
    await expect(hardware.confirm).toHaveCount(1)
    await expect(hardware.confirmOk).toHaveText('Отключить')

    // Opening another confirm replaces the first: never two at once.
    await profile.getByRole('button', { name: 'Отвязать', exact: true }).click()
    await expect(hardware.confirm).toHaveCount(1)
    await expect(profile.getByTestId('hardware-confirm')).toBeVisible()
    await expect(hardware.confirmOk).toHaveText('Отвязать')
    await expect(scale.getByRole('button', { name: 'Отключить', exact: true })).toBeVisible()

    // «Отмена» restores the profile row as it was.
    await hardware.confirmCancel.click()
    await expect(hardware.confirm).toHaveCount(0)
    await expect(profile.getByRole('button', { name: 'Отвязать', exact: true })).toBeVisible()
    await expect(profile.getByRole('button', { name: 'Код согласия', exact: true })).toBeVisible()

    await scale.getByRole('button', { name: 'Отключить', exact: true }).click()
    await expect(hardware.confirm).toHaveCount(1)
    await hardware.confirmOk.click()

    const unpair = await stream.nextCommand('unpair')
    expect(unpair.hardwareId).toBe(hardwareId)
    expect(unpair.address).toBe(SCALE_ADDRESS)
    await expect(scale).toHaveCount(0)
    await expect(hardware.confirm).toHaveCount(0)
  } finally {
    stream.close()
  }
})

test('phone: the window and the wizard are full-screen sheets with a pinned primary button', async ({
  page,
  stack,
}) => {
  await page.setViewportSize(PHONE)
  await seedSession(page.request)
  const gateway = makeFakeGateway(stack.apiURL)
  const stream = await connectGatewayViaApi(page.request, gateway)
  try {
    await page.goto('/')
    const hardware = new HardwarePage(page)
    await hardware.open()
    await expect(hardware.primary).toHaveText('Добавить оборудование')

    const dialogBox = await boxOf(hardware.dialog)
    expect(dialogBox.x).toBeCloseTo(0, 0)
    expect(dialogBox.y).toBeCloseTo(0, 0)
    expect(dialogBox.width).toBeCloseTo(PHONE.width, 0)
    expect(dialogBox.height).toBeCloseTo(PHONE.height, 0)

    const primaryBox = await boxOf(hardware.primary)
    expect(PHONE.height - (primaryBox.y + primaryBox.height)).toBeLessThanOrEqual(24)
    expect(PHONE.height - (primaryBox.y + primaryBox.height)).toBeGreaterThanOrEqual(0)

    // The body between the pinned header and footer is the part that scrolls.
    const body = hardware.dialog.locator('[data-slot="phone-sheet-body"]')
    await expect(body).toHaveCount(1)
    expect(await body.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')

    // A confirm row takes the whole width of the list body.
    await hardware.gatewayRow(gateway.gatewayId).getByRole('button', { name: 'Отозвать' }).click()
    await expect(hardware.confirm).toBeVisible()
    const listContentWidth = await hardware.dialog
      .getByTestId('hardware-list')
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      })
    const confirmBox = await boxOf(hardware.confirm)
    expect(confirmBox.width).toBeCloseTo(listContentWidth, 0)
    await hardware.confirmCancel.click()
    await expect(hardware.confirm).toHaveCount(0)

    // The wizard replaces the list in the same full-screen sheet.
    await hardware.primary.click()
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'scan')
    await stream.nextCommand('scan.start')
    await postGatewayEvents(gateway, [scaleScanResult()])
    await hardware.scanResult(SCALE_ADDRESS).getByRole('button', { name: 'Выбрать' }).click()
    await stream.nextCommand('pair')
    await expect(hardware.wizardStep).toHaveAttribute('data-step', 'pairing')

    const wizardBox = await boxOf(hardware.dialog)
    expect(wizardBox.width).toBeCloseTo(PHONE.width, 0)
    expect(wizardBox.height).toBeCloseTo(PHONE.height, 0)

    const back = hardware.dialog.getByTestId('hardware-wizard-back')
    const close = hardware.button('Закрыть')
    await expect(back).toBeVisible()
    await expect(close).toBeVisible()
    const backBox = await boxOf(back)
    const closeBox = await boxOf(close)
    expect(backBox.y).toBeLessThan(80)
    expect(closeBox.y).toBeLessThan(80)
    expect(backBox.x).toBeLessThan(closeBox.x)

    const pair = hardware.dialog.getByTestId('hardware-wizard-pair')
    await expect(pair).toBeVisible()
    const pairBox = await boxOf(pair)
    expect(PHONE.height - (pairBox.y + pairBox.height)).toBeLessThanOrEqual(24)
    expect(PHONE.height - (pairBox.y + pairBox.height)).toBeGreaterThanOrEqual(0)
    expect(pairBox.width).toBeGreaterThan(PHONE.width / 2)
  } finally {
    stream.close()
  }
})
