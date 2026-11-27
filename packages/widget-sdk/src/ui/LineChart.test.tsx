import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LineChart, type LineChartProps } from './LineChart'

const POINTS: LineChartProps['points'] = [
  { x: '2026-09-01', y: 4.44 },
  { x: '2026-10-01', y: 4.4 },
  { x: '2026-11-21', y: 4.32 },
]

describe('LineChart', () => {
  it('draws three points as one polyline, hidden, with the summary for assistive tech', () => {
    const { container } = render(
      <LineChart
        points={POINTS}
        yLabels={['4,44', '4,38', '4,32']}
        xLabels={[
          { at: '2026-09-01', label: '1 сен' },
          { at: '2026-11-21', label: '21 ноя' },
        ]}
        variant="full"
        summary="Вес с сентября по ноябрь: 4,44; 4,40; 4,32 кг"
      />,
    )

    const polylines = container.querySelectorAll('polyline')
    expect(polylines).toHaveLength(1)
    expect(polylines[0].getAttribute('points')?.trim().split(/\s+/)).toHaveLength(3)
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByText('Вес с сентября по ноябрь: 4,44; 4,40; 4,32 кг')).toBeInTheDocument()
  })

  it('spans the data from the top gridline to the bottom one', () => {
    const { container } = render(
      <LineChart points={POINTS} yLabels={[]} xLabels={[]} variant="spark" summary="s" />,
    )
    const ys = (container.querySelector('polyline')?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[1]))
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys))
    expect(ys[0]).toBe(Math.min(...ys))
    expect(ys[2]).toBe(Math.max(...ys))
  })

  it('a y domain puts its max on the top gridline and its min on the bottom one', () => {
    const { container } = render(
      <LineChart
        points={[
          { x: '2026-09-01', y: 4.47 },
          { x: '2026-10-01', y: 4.37 },
          { x: '2026-11-01', y: 4.27 },
        ]}
        yDomain={{ min: 4.27, max: 4.47 }}
        yLabels={['4,47', '4,37', '4,27']}
        xLabels={[]}
        variant="full"
        summary="s"
      />,
    )
    const ys = (container.querySelector('polyline')?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[1]))
    // The full variant's gridlines sit at y = 20 (top) and y = 200 (bottom).
    expect(ys).toEqual([20, 110, 200])
  })

  it('a domain wider than the data leaves room above and below the line', () => {
    const { container } = render(
      <LineChart
        points={POINTS}
        yDomain={{ min: 4.27, max: 4.49 }}
        yLabels={[]}
        xLabels={[]}
        variant="full"
        summary="s"
      />,
    )
    const ys = (container.querySelector('polyline')?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[1]))
    expect(Math.min(...ys)).toBeGreaterThan(20)
    expect(Math.max(...ys)).toBeLessThan(200)
  })

  it('places x by time, not by index', () => {
    const { container } = render(
      <LineChart points={POINTS} yLabels={[]} xLabels={[]} variant="spark" summary="s" />,
    )
    const xs = (container.querySelector('polyline')?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[0]))
    // 1 сен → 1 окт is 30 days of the 81-day span, so the middle point sits left of centre.
    expect(xs[1] - xs[0]).toBeLessThan(xs[2] - xs[1])
  })

  it('renders the labels', () => {
    render(
      <LineChart
        points={POINTS}
        yLabels={['4,44', '4,32']}
        xLabels={[{ at: '2026-11-21', label: '21 ноя' }]}
        variant="full"
        summary="s"
      />,
    )
    expect(screen.getByText('4,44')).toBeInTheDocument()
    expect(screen.getByText('21 ноя')).toBeInTheDocument()
  })

  it('draws nothing but the summary without points', () => {
    const { container } = render(
      <LineChart points={[]} yLabels={[]} xLabels={[]} variant="spark" summary="Нет данных" />,
    )
    expect(container.querySelector('polyline')).toBeNull()
    expect(screen.getByText('Нет данных')).toBeInTheDocument()
  })
})
