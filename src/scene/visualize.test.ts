import { describe, expect, it } from 'vitest'
import { rowPositions, normalizeHeights, pickLayout, MAX_POINTS } from './visualize'

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
