// @vitest-environment jsdom
import { context } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeActivationModel } from '../model/activation-model'
import { ActivateScreen } from './ActivateScreen'

beforeEach(() => context.reset())

function model(token: string | null) {
  return makeActivationModel({ token, http: makeScriptedHttp({}).http })
}

describe('ActivateScreen', () => {
  it('renders the HOME login landing when there is no token', () => {
    render(<ActivateScreen model={model(null)} onScan={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Войти с passkey/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сканировать QR-код/ })).toBeInTheDocument()
  })

  it('renders the ACTIVATE registration screen when a token is present', () => {
    render(<ActivateScreen model={model('invite')} onScan={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Активация устройства' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ваше имя')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Создать passkey/ })).toBeInTheDocument()
  })

  it('renders the NO-CODE screen when the token param is empty', () => {
    render(<ActivateScreen model={model('')} onScan={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Нужен код приглашения' })).toBeInTheDocument()
  })

  it('renders the USED screen and offers login', () => {
    const m = model('invite')
    m.screen.set('activate-used')
    render(<ActivateScreen model={m} onScan={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'Приглашение уже использовано' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Войти с passkey/ })).toBeInTheDocument()
  })

  it('the ACTIVATE cross-link switches to the HOME screen', () => {
    render(<ActivateScreen model={model('invite')} onScan={vi.fn()} />)

    fireEvent.click(screen.getByText(/Уже активировано\?/))

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('the scan button invokes onScan', () => {
    const onScan = vi.fn()
    render(<ActivateScreen model={model(null)} onScan={onScan} />)

    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))

    expect(onScan).toHaveBeenCalledTimes(1)
  })
})
