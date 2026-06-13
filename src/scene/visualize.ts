// PURE layout engine for the visualize_data tool. Turns a `series` of data points
// (supplied by the agent) into a list of ObjectSpec — plain records the scene
// store spawns as ordinary `text`/`box` objects. No React, no three, no store
// access: data in, data out, fully unit-testable.
//
// DESIGN NOTE (this module is expected to be refactored a lot — keep it heavily
// commented): each "layout" is a standalone pure function
// (series, anchor, title?) -> ObjectSpec[]. They share two helpers — rowPositions
// (even, centred spacing along x) and normalizeHeights (value -> bar height in
// metres). To add a chart type: add a function + a Layout entry + a handler case.
// Nothing else here depends on any single layout.

/** A world-space point [x, y, z] in metres (y up, -z in front of the user). */
export type Vec3 = [number, number, number]

/** One data point the agent supplies. Deliberately small and optional-heavy so a
 *  single shape feeds every template: a bar chart uses `value`; a weather card
 *  uses label/value/secondary/caption. */
export interface DataPoint {
  label: string        // x-axis tick / card title, e.g. "Mon"
  value?: number       // primary number — bar height / the stat figure
  secondary?: number   // a second number cards show, e.g. the low temp
  caption?: string     // qualitative text, e.g. "partly cloudy"
  color?: string       // optional per-point CSS colour override
}

export type Layout = 'card_row' | 'bar_chart' | 'timeline' | 'stat'

/** A plain spawn instruction — a loose subset of the store's SpawnArgs. The
 *  handler spreads this into scene.spawn() and stamps a groupId on top. We only
 *  ever emit `text` panels and `box` primitives, so no renderer work is needed. */
export interface ObjectSpec {
  kind: 'text' | 'box'
  position: Vec3
  size?: number
  color?: string
  text?: string                      // for kind:'text'
  scale?: [number, number, number]   // for kind:'box' — the Y axis carries bar height
  label?: string                     // human handle (also enriches the scene summary)
}

// ---- tuning constants (the knobs to tweak in-headset) ----------------------
const CARD_GAP = 1.4   // metres between adjacent card/timeline panel centres
const BAR_GAP = 0.55   // metres between bar centres — MUST stay > BAR_WIDTH so bars never touch/collide
const BAR_WIDTH = 0.3  // metres — a bar's x/z footprint
const MIN_BAR = 0.2    // metres — height rendered for the series' smallest value
const MAX_BAR = 2.0    // metres — height rendered for the series' largest value
const MARKER = 0.18    // metres — timeline marker cube size
const TITLE_DY = 0.9   // metres — how far a title panel floats above the row
const LABEL_DY = 0.35  // metres — how far a bar/marker label floats from the object
/** Hard cap on points so a runaway series can't flood the scene. */
export const MAX_POINTS = 24

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Even, centred spacing along x around an anchor. Returns one x per item so the
 *  row is symmetric about anchorX — the viz always appears centred in front of the
 *  user regardless of how many points there are. */
export function rowPositions(count: number, gap: number, anchorX: number): number[] {
  const width = (count - 1) * gap   // span between the first and last centre
  const left = anchorX - width / 2  // leftmost centre
  return Array.from({ length: count }, (_, i) => round(left + i * gap))
}

/** Map each value to a bar height in [MIN_BAR, MAX_BAR], scaled across the series'
 *  OWN min..max so the tallest bar is always MAX_BAR and differences read clearly.
 *  A flat series (all equal, or a single point) → every bar at MAX_BAR. Missing or
 *  non-finite values are treated as the series minimum (a short but present bar). */
export function normalizeHeights(values: number[]): number[] {
  const nums = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
  const present = nums.filter((v) => !Number.isNaN(v))
  if (present.length === 0) return values.map(() => MIN_BAR)
  const min = Math.min(...present)
  const max = Math.max(...present)
  return nums.map((v) => {
    const x = Number.isNaN(v) ? min : v
    if (max === min) return MAX_BAR             // flat series → all full height
    const t = (x - min) / (max - min)           // 0..1 within the series
    return round(MIN_BAR + t * (MAX_BAR - MIN_BAR))
  })
}

/** Choose a layout from the data shape when the agent didn't specify one:
 *  one point → a single stat; every point carries a numeric value → bars;
 *  otherwise a row of cards (the most forgiving, text-first layout). */
export function pickLayout(series: DataPoint[]): Layout {
  if (series.length === 1) return 'stat'
  const allNumeric = series.every((p) => typeof p.value === 'number' && Number.isFinite(p.value))
  return allNumeric ? 'bar_chart' : 'card_row'
}

// Re-exported for the layout functions in Task 3/4 (kept module-private constants
// accessible to them since they live in this same file).
export const _CONST = { CARD_GAP, BAR_GAP, BAR_WIDTH, MIN_BAR, MAX_BAR, MARKER, TITLE_DY, LABEL_DY }
