// @vitest-environment jsdom
import { context } from '@reatom/core'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  makeFakeWizardModel,
  makeGateway,
  makeHardware,
  makeSnapshot,
  makeTestHardwareModel,
} from '../model/testing'
import { makeWizardModel } from '../model/wizard-model'
import { HealthProfileForm } from './HealthProfileForm'

beforeEach(() => context.reset())

describe('HealthProfileForm (§4 c2)', () => {
  it('shows the note, the fields and the sex toggle', () => {
    const { model } = makeFakeWizardModel({ step: { kind: 'healthForm', hardwareId: 'h1' } })
    render(<HealthProfileForm wizard={model} />)

    expect(
      screen.getByText(/Весы считают состав тела по росту, возрасту и полу/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Рост, см')).toHaveAttribute('inputMode', 'numeric')
    expect(screen.getByLabelText('Дата рождения')).toHaveAttribute('placeholder', 'ДД.ММ.ГГГГ')
    expect(screen.getByRole('group', { name: 'Пол' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Мужской' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Женский' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('an invalid height marks the field (real wizard model)', async () => {
    const { model: hardware } = makeTestHardwareModel(
      makeSnapshot([makeGateway()], [makeHardware()]),
    )
    const wizard = makeWizardModel({
      hardware,
      client: makeHardwareBoardClient(makeScriptedHttp({}).http),
      health: async () => new Error('not needed: the form fails before saving'),
      hasWeightCard: () => false,
    })
    wizard.step.set({ kind: 'healthForm', hardwareId: 'h1' })
    render(<HealthProfileForm wizard={wizard} />)

    fireEvent.change(screen.getByLabelText('Рост, см'), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText('Дата рождения'), { target: { value: '14.03.1992' } })
    fireEvent.click(screen.getByRole('button', { name: 'Мужской' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и создать профиль' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Рост, см')).toHaveAttribute('aria-invalid', 'true'),
    )
    expect(screen.getByLabelText('Дата рождения')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('valid input fills the form and calls saveHealthAndCreate', async () => {
    const { model, called } = makeFakeWizardModel({
      step: { kind: 'healthForm', hardwareId: 'h1' },
    })
    render(<HealthProfileForm wizard={model} />)

    fireEvent.change(screen.getByLabelText('Рост, см'), { target: { value: '182' } })
    fireEvent.change(screen.getByLabelText('Дата рождения'), { target: { value: '14.03.1992' } })
    fireEvent.click(screen.getByRole('button', { name: 'Женский' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Женский' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и создать профиль' }))

    await waitFor(() => expect(called('saveHealthAndCreate')).toHaveLength(1))
    expect(model.profileForm()).toEqual({ height: '182', birthDate: '14.03.1992', sex: 'female' })
  })

  it('a failed save shows an error', () => {
    const { model } = makeFakeWizardModel({
      step: { kind: 'healthForm', hardwareId: 'h1' },
      formError: 'save',
    })
    render(<HealthProfileForm wizard={model} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/Не получилось сохранить/)
  })
})
