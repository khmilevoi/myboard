// @vitest-environment jsdom
import { context, notify } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('shows the checking state while the invite is being confirmed', () => {
    render(<ActivateScreen model={model('invite')} onScan={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Проверяем приглашение…' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ваше имя')).not.toBeInTheDocument()
  })

  it('confirms an accepted invite with its expiry, and offers no scan button', () => {
    const m = model('invite')
    act(() => {
      m.inviteExpiresAt.set(new Date(2026, 11, 3).getTime())
      m.screen.set('activate')
      notify()
    })
    render(<ActivateScreen model={m} onScan={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Приглашение принято' })).toBeInTheDocument()
    expect(screen.getByText(/Действует до 3 дек/)).toBeInTheDocument()
    expect(screen.getByLabelText('Ваше имя')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Создать passkey/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Сканировать QR-код/ })).not.toBeInTheDocument()
  })

  it.each([
    ['activate-expired', 'Приглашение истекло'],
    ['activate-not-found', 'Приглашение не найдено'],
    ['activate-locked', 'Слишком много попыток'],
  ] as const)('explains a %s invite and lets the user scan another code', (state, heading) => {
    const m = model('invite')
    const onScan = vi.fn()
    act(() => {
      m.screen.set(state)
      notify()
    })
    render(<ActivateScreen model={m} onScan={onScan} />)

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /QR-код/ }))
    expect(onScan).toHaveBeenCalledOnce()
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
    const m = model('invite')
    act(() => {
      m.screen.set('activate')
      notify()
    })
    render(<ActivateScreen model={m} onScan={vi.fn()} />)

    fireEvent.click(screen.getByText(/Уже есть passkey\?/))

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('the scan button invokes onScan', () => {
    const onScan = vi.fn()
    render(<ActivateScreen model={model(null)} onScan={onScan} />)

    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))

    expect(onScan).toHaveBeenCalledTimes(1)
  })
})
