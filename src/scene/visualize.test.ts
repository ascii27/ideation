import { describe, expect, it } from 'vitest'
import {
  rowPositions, normalizeHeights, pickLayout, MAX_POINTS,
  layoutCardRow, layoutStat, layoutBarChart, layoutTimeline, _CONST, panelWidth,
  spreadByWidth, galleryAnchor, nextFreeSlot,
  type DataPoint, type Vec3,
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

  it('scales correctly across negative values (span math is sign-agnostic)', () => {
    const h = normalizeHeights([-10, 0, 10])
    expect(h[0]).toBeCloseTo(_CONST.MIN_BAR) // series min → MIN_BAR
    expect(h[2]).toBeCloseTo(_CONST.MAX_BAR) // series max → MAX_BAR
    expect(h[1]).toBeCloseTo(1.1)            // midpoint of the -10..10 span
  })

  it('picks a layout from the data shape', () => {
    expect(pickLayout([{ label: 'a' }])).toBe('stat')
    expect(pickLayout([{ label: 'a', value: 1 }, { label: 'b', value: 2 }])).toBe('bar_chart')
    expect(pickLayout([{ label: 'a', value: 1 }, { label: 'b', caption: 'x' }])).toBe('card_row')
  })

  it('exposes a points cap', () => {
    expect(MAX_POINTS).toBeGreaterThan(0)
  })

  it('galleryAnchor marches successive vizzes along +x', () => {
    const base: Vec3 = [0, 1.3, -2.5]
    expect(galleryAnchor(base, 0)).toEqual([0, 1.3, -2.5])
    expect(galleryAnchor(base, 1)).toEqual([_CONST.GALLERY_STEP, 1.3, -2.5])
    expect(galleryAnchor(base, 2)).toEqual([_CONST.GALLERY_STEP * 2, 1.3, -2.5])
  })

  it('nextFreeSlot reuses the lowest freed gallery slot', () => {
    expect(nextFreeSlot([])).toBe(0)
    expect(nextFreeSlot([0, 1, 2])).toBe(3)
    expect(nextFreeSlot([0, 2])).toBe(1)   // interior gap is reused, not stacked
    expect(nextFreeSlot([2, 1])).toBe(0)
  })

  it('panelWidth mirrors the renderer clamp and scales by size', () => {
    expect(panelWidth('hi', 1)).toBeCloseTo(1.2)               // short text → min 1.2
    expect(panelWidth('x'.repeat(50), 1)).toBeCloseTo(4)        // long text → max 4
    expect(panelWidth('hi', 0.5)).toBeCloseTo(0.6)              // scaled by size
    expect(panelWidth('hi')).toBeCloseTo(1.2)                   // size defaults to 1
  })
})

describe('spreadByWidth', () => {
  it('centres a row about anchorX with no overlapping panels', () => {
    const widths = [1.2, 2.0, 1.2]
    const gap = 0.4
    const xs = spreadByWidth(widths, gap, 0)
    // whole row centred about 0 (outer edges symmetric)
    const leftEdge = xs[0] - widths[0] / 2
    const rightEdge = xs[2] + widths[2] / 2
    expect(leftEdge).toBeCloseTo(-rightEdge)
    // adjacent panels do not overlap: centre gap >= half-widths + margin
    for (let i = 0; i < xs.length - 1; i++) {
      const need = (widths[i] + widths[i + 1]) / 2 + gap
      expect(xs[i + 1] - xs[i]).toBeGreaterThanOrEqual(need - 1e-9)
    }
  })

  it('handles a single panel (sits on the anchor) and empty input', () => {
    expect(spreadByWidth([2], 0.4, 5)).toEqual([5])
    expect(spreadByWidth([], 0.4, 0)).toEqual([])
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
    // whole row centred about the anchor and panels don't overlap
    const xs = cards.map((s) => s.position[0])
    const ws = cards.map((s) => panelWidth(s.text ?? '', s.size ?? 1))
    const leftEdge = xs[0] - ws[0] / 2
    const rightEdge = xs[xs.length - 1] + ws[ws.length - 1] / 2
    expect(leftEdge).toBeCloseTo(-rightEdge)
    for (let i = 0; i < xs.length - 1; i++) {
      expect(xs[i + 1] - xs[i]).toBeGreaterThanOrEqual((ws[i] + ws[i + 1]) / 2 + _CONST.PANEL_MARGIN - 0.01)
    }
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

describe('box layouts', () => {
  const series: DataPoint[] = [
    { label: 'Mon', value: 10 },
    { label: 'Tue', value: 20 },
    { label: 'Wed', value: 30 },
  ]

  it('bars never touch (gap wider than width) so physics leaves them at rest', () => {
    expect(_CONST.BAR_GAP).toBeGreaterThan(_CONST.BAR_WIDTH)
  })

  it('bar_chart emits a box bar + a text label per point (+ optional title)', () => {
    const specs = layoutBarChart(series, [0, 1.3, -2.5], 'Temps')
    const bars = specs.filter((s) => s.kind === 'box')
    const labels = specs.filter((s) => s.kind === 'text' && s.label !== 'title')
    expect(bars).toHaveLength(3)
    expect(labels).toHaveLength(3)
    expect(specs.some((s) => s.label === 'title')).toBe(true)
  })

  it('bars stand on the floor: centre y = height/2, tallest is MAX_BAR', () => {
    const bars = layoutBarChart(series, [0, 1.3, -2.5]).filter((s) => s.kind === 'box')
    // tallest (value 30) → full height 2.0 → centre y 1.0, scaleY = 2.0 / BAR_WIDTH
    const tallest = bars[2]
    expect(tallest.position[1]).toBeCloseTo(1.0)
    expect(tallest.scale?.[1]).toBeCloseTo(2.0 / _CONST.BAR_WIDTH)
    // base on floor: centre y ≈ (size * scaleY) / 2
    expect(tallest.position[1]).toBeCloseTo((tallest.size! * tallest.scale![1]) / 2)
  })

  it('timeline lays ordered markers with labels (boxes on the floor)', () => {
    const specs = layoutTimeline(series, [0, 1.3, -2.5])
    const markers = specs.filter((s) => s.kind === 'box')
    expect(markers).toHaveLength(3)
    // left→right by array order
    expect(markers[0].position[0]).toBeLessThan(markers[2].position[0])
    // markers rest on the floor
    expect(markers[0].position[1]).toBeCloseTo(_CONST.MARKER / 2)
  })

  it('bar_chart with a single point: one full-height bar centred on the anchor', () => {
    const specs = layoutBarChart([{ label: 'Solo', value: 42 }], [0, 1.3, -2.5])
    const bars = specs.filter((s) => s.kind === 'box')
    const labels = specs.filter((s) => s.kind === 'text' && s.label !== 'title')
    expect(bars).toHaveLength(1)
    expect(labels).toHaveLength(1)
    expect(specs.some((s) => s.label === 'title')).toBe(false)
    // flat series (one point) → MAX_BAR; centred on anchor x
    expect(bars[0].position[0]).toBeCloseTo(0)
    expect(bars[0].position[1]).toBeCloseTo(_CONST.MAX_BAR / 2)
    expect(bars[0].scale?.[1]).toBeCloseTo(_CONST.MAX_BAR / _CONST.BAR_WIDTH)
  })

  it('bar_chart with a missing value: short bar (MIN_BAR) and a number-less label', () => {
    // A and C span the range; B has no value → treated as the series minimum.
    const specs = layoutBarChart(
      [{ label: 'A', value: 10 }, { label: 'B' }, { label: 'C', value: 30 }],
      [0, 1.3, -2.5],
    )
    const bars = specs.filter((s) => s.kind === 'box')
    // the value-less point (B) → MIN_BAR height, base on floor
    expect(bars[1].position[1]).toBeCloseTo(_CONST.MIN_BAR / 2)
    expect(bars[1].scale?.[1]).toBeCloseTo(_CONST.MIN_BAR / _CONST.BAR_WIDTH)
    // its label shows just "B" — no number appended
    const labelB = specs.find((s) => s.kind === 'text' && s.text?.startsWith('B'))
    expect(labelB?.text).toBe('B')
  })

  it('bar_chart widens bar spacing so labels never overlap', () => {
    const longSeries: DataPoint[] = [
      { label: 'January', value: 10 },
      { label: 'February', value: 20 },
    ]
    const specs = layoutBarChart(longSeries, [0, 0, -3])
    const bars = specs.filter((s) => s.kind === 'box')
    const gap = Math.abs(bars[1].position[0] - bars[0].position[0])
    const widest = Math.max(
      panelWidth('January 10', _CONST.LABEL_SIZE),
      panelWidth('February 20', _CONST.LABEL_SIZE),
    )
    expect(gap).toBeGreaterThanOrEqual(widest + _CONST.PANEL_MARGIN - 1e-9)
    expect(gap).toBeGreaterThanOrEqual(_CONST.BAR_GAP)
  })
})
