import { describe, expect, it } from 'vitest'
import {
  rowPositions, normalizeHeights, pickLayout, MAX_POINTS,
  layoutCardRow, layoutStat,
  type DataPoint,
} from './visualize'

describe('visualize core helpers', () => {
  it('centres a row symmetrically about the anchor x', () => {
    // 3 items, gap 2, anchor 0 → [-2, 0, 2]
    expect(rowPositions(3, 2, 0)).toEqual([-2, 0, 2])
    // single item sits on the anchor
    expect(rowPositions(1, 2, 5)).toEqual([5])
  })

  it('normalizes heights across the series min..max', () => {
    const h = normalizeHeights([10, 20, 30])
    expect(h[0]).toBeCloseTo(0.2) // min → MIN_BAR
    expect(h[2]).toBeCloseTo(2.0) // max → MAX_BAR
    expect(h[1]).toBeCloseTo(1.1) // midpoint
  })

  it('gives a flat series all full-height bars', () => {
    expect(normalizeHeights([5, 5, 5])).toEqual([2.0, 2.0, 2.0])
    expect(normalizeHeights([7])).toEqual([2.0])
  })

  it('treats missing values as the series minimum height', () => {
    const h = normalizeHeights([10, NaN, 30])
    expect(h[1]).toBeCloseTo(0.2)
  })

  it('picks a layout from the data shape', () => {
    expect(pickLayout([{ label: 'a' }])).toBe('stat')
    expect(pickLayout([{ label: 'a', value: 1 }, { label: 'b', value: 2 }])).toBe('bar_chart')
    expect(pickLayout([{ label: 'a', value: 1 }, { label: 'b', caption: 'x' }])).toBe('card_row')
  })

  it('exposes a points cap', () => {
    expect(MAX_POINTS).toBeGreaterThan(0)
  })
})

describe('text layouts', () => {
  const series: DataPoint[] = [
    { label: 'Mon', value: 24, secondary: 18, caption: 'partly cloudy' },
    { label: 'Tue', value: 26, secondary: 19, caption: 'overcast' },
    { label: 'Wed', value: 23, secondary: 19, caption: 'rain' },
  ]

  it('card_row makes one text panel per point, centred, plus an optional title', () => {
    const specs = layoutCardRow(series, [0, 1.3, -2.5], 'Tokyo')
    const cards = specs.filter((s) => s.label !== 'title')
    expect(cards).toHaveLength(3)
    expect(cards.every((s) => s.kind === 'text')).toBe(true)
    // centred: x positions symmetric about 0
    const xs = cards.map((s) => s.position[0])
    expect(xs[0]).toBeCloseTo(-xs[2])
    expect(xs[1]).toBeCloseTo(0)
    // multi-line card text includes label, both temps, and caption
    expect(cards[0].text).toContain('Mon')
    expect(cards[0].text).toContain('24')
    expect(cards[0].text).toContain('18')
    expect(cards[0].text).toContain('partly cloudy')
    // title present
    expect(specs.some((s) => s.label === 'title' && s.text === 'Tokyo')).toBe(true)
  })

  it('card_row omits absent fields and the title when not given', () => {
    const specs = layoutCardRow([{ label: 'X' }], [0, 1.3, -2.5])
    expect(specs).toHaveLength(1)
    expect(specs[0].text).toBe('X')
  })

  it('stat renders one big panel from the first point', () => {
    const specs = layoutStat([{ label: 'Tokyo', value: 24, caption: 'sunny' }], [0, 1.3, -2.5], 'Now')
    expect(specs).toHaveLength(1)
    expect(specs[0].kind).toBe('text')
    expect(specs[0].text).toContain('24')
    expect(specs[0].text).toContain('sunny')
    expect(specs[0].text).toContain('Now')
  })
})
