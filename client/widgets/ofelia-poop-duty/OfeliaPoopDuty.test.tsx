// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WidgetRuntimeProps } from '../../src/widget-host/types'
import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const fixedNow = new Date('2026-06-16T10:00:00.000Z')

function props(mode: WidgetRuntimeProps['mode']): WidgetRuntimeProps {
  return {
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
    mode,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    reportError: vi.fn(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(fixedNow)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OfeliaPoopDuty', () => {
  it('shows today and tomorrow in small mode', () => {
    render(<OfeliaPoopDuty {...props('small')} />)

    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('Завтра: Карина')).toBeInTheDocument()
  })

  it('shows today and tomorrow in large mode', () => {
    render(<OfeliaPoopDuty {...props('large')} />)

    expect(screen.getByRole('heading', { name: 'Кто сегодня убирает какахи Офелии' })).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('Завтра: Карина')).toBeInTheDocument()
  })
})

