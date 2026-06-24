# Data Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `visualize_data` agent tool that turns an agent-supplied data `series` into a grouped set of 3D objects (text panels + box bars) via four pure layout templates.

**Architecture:** A new PURE, heavily-commented module `src/scene/visualize.ts` maps `series` → `ObjectSpec[]` for each layout (card_row/bar_chart/timeline/stat); the store gains a light `groupId` tag (+ `removeGroup`/`nextGroupId`) so a visualization is one manageable unit; the `visualize_data` handler picks the layout (or a heuristic), spawns the specs under one `groupId`, and returns it. Reuses existing `text`/`box` renderers — no renderer changes.

**Tech Stack:** TypeScript (React + R3F frontend, ESM), zustand store, vitest. Spec: `docs/superpowers/specs/2026-06-13-visualization-design.md`.

**Conventions (READ FIRST):**
- **`src/` frontend imports OMIT the `.ts` extension** (e.g. `import { useScene } from '../scene/store'`) — match the neighbouring files. (Server code uses `.ts`; this plan is all `src/`.)
- `verbatimModuleSyntax: true` + `strict` + `noUnusedLocals`/`noUnusedParameters` — type-only imports use `import type`; no unused vars.
- Tests are vitest. Full suite: `npm test`. One file: `npx vitest run <path>`. Filter: `npx vitest run <path> -t "<name>"`.
- `npm run typecheck` = `tsc --noEmit`. Commit after each task.
- **Comment density (explicit user requirement):** `src/scene/visualize.ts` and the new handler code MUST carry generous, design-explaining comments (the *why*, the layout math, the grouping). The code blocks below already include these comments — preserve them; don't strip them down.

---

### Task 1: Grouping in the scene store (TDD)

**Files:**
- Modify: `src/scene/types.ts` (add `groupId` to `SceneObject`)
- Modify: `src/scene/store.ts` (`SpawnArgs.groupId`, thread it in `spawn`, add `groupSeq`/`nextGroupId`/`removeGroup`, group-aware `summary`)
- Test: `src/scene/store.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to the END of `src/scene/store.test.ts`:
```ts
describe('object grouping', () => {
  it('mints monotonic group ids', () => {
    expect(useScene.getState().nextGroupId()).toBe('viz-1')
    expect(useScene.getState().nextGroupId()).toBe('viz-2')
  })

  it('spawns objects carrying a groupId and removes them as a unit', () => {
    const g = useScene.getState().nextGroupId()
    useScene.getState().spawn({ kind: 'text', text: 'a', groupId: g })
    useScene.getState().spawn({ kind: 'box', groupId: g })
    useScene.getState().spawn({ kind: 'box' }) // ungrouped — must survive
    expect(useScene.getState().objects.filter((o) => o.groupId === g)).toHaveLength(2)
    const removed = useScene.getState().removeGroup(g)
    expect(removed).toBe(2)
    expect(useScene.getState().objects).toHaveLength(1)
    expect(useScene.getState().objects[0].groupId).toBeUndefined()
  })

  it('notes groups in the summary', () => {
    const g = useScene.getState().nextGroupId()
    useScene.getState().spawn({ kind: 'text', text: 'a', groupId: g })
    useScene.getState().spawn({ kind: 'text', text: 'b', groupId: g })
    expect(useScene.getState().summary()).toContain(`${g} (2 objects)`)
  })
})
```
Note: `useScene`, `describe/it/expect` are already imported at the top of this file; `beforeEach` already calls `useScene.getState().clear()`.

Also extend the existing `beforeEach` at the top of `src/scene/store.test.ts` so the group counter resets between tests (it's store-global and `clear()` doesn't reset it). Change:
```ts
  useScene.setState({ activities: [], activitySeq: 0 })
```
to:
```ts
  useScene.setState({ activities: [], activitySeq: 0, groupSeq: 0 })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/scene/store.test.ts -t "object grouping"`
Expected: FAIL — `nextGroupId`/`removeGroup` don't exist and `groupId` isn't accepted/stored.

- [ ] **Step 3: Add `groupId` to the SceneObject type**

In `src/scene/types.ts`, inside `interface SceneObject`, add this field right after the `glow?: number` line (before the closing `}`):
```ts
  /** Tags this object as part of a visualization group (e.g. "viz-1") so the
   *  whole group can be removed/moved as one unit. Set by the visualize_data
   *  tool; ungrouped objects leave it undefined. */
  groupId?: string
```

- [ ] **Step 4: Thread grouping through the store**

In `src/scene/store.ts`:

(a) Add `groupId` to `SpawnArgs` (after the `position?...` line, before the closing `}` of `SpawnArgs`):
```ts
  /** Optional visualization-group tag (see SceneObject.groupId). */
  groupId?: string
```

(b) In the `spawn` function, add `groupId` to the constructed `obj` (right after the `glow: args.glow,` line):
```ts
      groupId: args.groupId,
```

(c) In the `SceneState` interface, add these members (next to `remove`):
```ts
  /** Remove every object tagged with `groupId`; returns how many were removed. */
  removeGroup: (groupId: string) => number
  /** Monotonic source of visualization group ids ("viz-1", "viz-2", …). */
  groupSeq: number
  /** Mint the next unique group id. */
  nextGroupId: () => string
```

(d) Add `groupSeq` to the initial state (next to `activitySeq: 0,`):
```ts
  groupSeq: 0,
```

(e) Implement the actions (add after the `remove:` action):
```ts
  removeGroup: (groupId) => {
    const { objects } = get()
    const keep = objects.filter((o) => o.groupId !== groupId)
    const removed = objects.length - keep.length
    if (removed > 0) set({ objects: keep })
    return removed
  },

  nextGroupId: () => {
    // Monotonic like activitySeq (NOT reset by clear()), so a group id is never
    // reused while the agent might still reference an earlier one.
    const seq = get().groupSeq + 1
    set({ groupSeq: seq })
    return `viz-${seq}`
  },
```

(f) Make `summary()` note groups. Change its final `return` from:
```ts
    return `${objects.length} object(s): ${parts.join('; ')}`
```
to:
```ts
    // Append a group roll-up so the agent can refer to a whole visualization
    // (e.g. "clear viz-1") rather than every member object individually.
    const groups = new Map<string, number>()
    for (const o of objects) if (o.groupId) groups.set(o.groupId, (groups.get(o.groupId) ?? 0) + 1)
    const groupNote = groups.size
      ? ` Groups: ${[...groups].map(([g, n]) => `${g} (${n} objects)`).join(', ')}.`
      : ''
    return `${objects.length} object(s): ${parts.join('; ')}${groupNote}`
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/scene/store.test.ts -t "object grouping"`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite (no regressions to existing summary tests)**

Run: `npm test`
Expected: PASS — all prior tests + 3 new. If a prior `summary()` test breaks, it means the ungrouped path changed; confirm `groupNote` is empty when there are no groups.

- [ ] **Step 7: Commit**

```bash
git add src/scene/types.ts src/scene/store.ts src/scene/store.test.ts
git commit -m "feat(scene): light groupId grouping (nextGroupId/removeGroup + group-aware summary)"
```

---

### Task 2: visualize.ts core — types, constants, helpers (TDD)

**Files:**
- Create: `src/scene/visualize.ts`
- Test: `src/scene/visualize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scene/visualize.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/scene/visualize.test.ts`
Expected: FAIL — cannot find module `./visualize`.

- [ ] **Step 3: Create the module core**

Create `src/scene/visualize.ts`:
```ts
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
```

Note: the `_CONST` export exists only so Task 3/4 layout functions (added to THIS file) can reference the constants without re-declaring them — but since those functions live in the same module, they will use the bare constant names directly. Keep `_CONST` for the test in Task 4 that checks BAR_GAP > BAR_WIDTH. (Do not delete it.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/scene/visualize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts
git commit -m "feat(visualize): pure core — DataPoint/ObjectSpec, rowPositions, normalizeHeights, pickLayout"
```

---

### Task 3: visualize.ts text layouts — card_row + stat (TDD)

**Files:**
- Modify: `src/scene/visualize.ts` (add `cardText`, `layoutCardRow`, `layoutStat`)
- Test: `src/scene/visualize.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/scene/visualize.test.ts` (the import line already pulls from `./visualize`; add the new names to it):
```ts
// extend the existing import at the top of the file to also bring in:
//   layoutCardRow, layoutStat
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
```
Update the top-of-file import to include the new functions:
```ts
import {
  rowPositions, normalizeHeights, pickLayout, MAX_POINTS,
  layoutCardRow, layoutStat,
  type DataPoint,
} from './visualize'
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/scene/visualize.test.ts -t "text layouts"`
Expected: FAIL — `layoutCardRow`/`layoutStat` are not exported.

- [ ] **Step 3: Implement the text layouts**

Append to `src/scene/visualize.ts` (use the bare constant names — they're in scope in this module):
```ts
/** Compose a card's multi-line text from whichever fields are present. Kept tiny
 *  and separate so the exact card formatting is trivial to tweak later. The
 *  value/secondary pair is rendered as "24° / 18°" (weather-friendly), or just the
 *  value alone when there is no secondary. */
function cardText(p: DataPoint): string {
  const lines: string[] = [p.label]
  if (p.value !== undefined) {
    lines.push(p.secondary !== undefined ? `${p.value}° / ${p.secondary}°` : `${p.value}`)
  }
  if (p.caption) lines.push(p.caption)
  return lines.join('\n')
}

/** card_row: a horizontal row of floating text panels (one per point), centred on
 *  the anchor at anchor.y. Optional title panel floats above the row centre.
 *  Panels are `text` kind → no physics, so they stay exactly where placed. Best
 *  for heterogeneous/qualitative data (the weather example reads great as cards). */
export function layoutCardRow(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const [ax, ay, az] = anchor
  const xs = rowPositions(series.length, CARD_GAP, ax)
  const specs: ObjectSpec[] = series.map((p, i) => ({
    kind: 'text',
    position: [xs[i], ay, az],
    text: cardText(p),
    color: p.color,
    label: p.label,
  }))
  if (title) {
    specs.push({ kind: 'text', position: [ax, round(ay + TITLE_DY), az], text: title, size: 1.4, label: 'title' })
  }
  return specs
}

/** stat: a single large text panel from the FIRST point (extra points ignored —
 *  use card_row/bar_chart for a series). Shows the big number with the caption and
 *  label beneath, and the title on top if given. */
export function layoutStat(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const p = series[0]
  const big = p.value !== undefined ? `${p.value}` : p.label
  const sub = [p.caption, p.value !== undefined ? p.label : undefined].filter(Boolean).join(' · ')
  const body = sub ? `${big}\n${sub}` : `${big}`
  const text = title ? `${title}\n${body}` : body
  return [{ kind: 'text', position: anchor, text, size: 2, color: p.color, label: 'stat' }]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/scene/visualize.test.ts`
Expected: PASS (all core + text-layout tests).

- [ ] **Step 5: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts
git commit -m "feat(visualize): card_row + stat text layouts"
```

---

### Task 4: visualize.ts box layouts — bar_chart + timeline (TDD)

**Files:**
- Modify: `src/scene/visualize.ts` (add `layoutBarChart`, `layoutTimeline`)
- Test: `src/scene/visualize.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Extend the top-of-file import to its final form (adds `layoutBarChart`, `layoutTimeline`, `_CONST` — do NOT import `ObjectSpec`, the test doesn't use it):
```ts
import {
  rowPositions, normalizeHeights, pickLayout, MAX_POINTS,
  layoutCardRow, layoutStat, layoutBarChart, layoutTimeline, _CONST,
  type DataPoint,
} from './visualize'
```
Then append:
```ts
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
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/scene/visualize.test.ts -t "box layouts"`
Expected: FAIL — `layoutBarChart`/`layoutTimeline` not exported.

- [ ] **Step 3: Implement the box layouts**

Append to `src/scene/visualize.ts`:
```ts
/** bar_chart: a row of box bars standing on the floor, height ∝ value (normalised
 *  across the series). HOW THE BAR IS BUILT: a unit box scaled by `size`=BAR_WIDTH
 *  gives a BAR_WIDTH cube; the Y `scale` then stretches it to the target height h
 *  (scaleY = h / BAR_WIDTH). We place its CENTRE at y = h/2 so the base sits on the
 *  floor and the bar spawns already at rest. A small text label floats just in
 *  front of each bar's foot; the title floats above the tallest possible bar.
 *
 *  PHYSICS NOTE: bars are real `box` solids (gravity on by default). BAR_GAP is
 *  kept > BAR_WIDTH so neighbours never touch/collide, and resting on the floor
 *  means gravity won't move them. A grab can still knock one over — acceptable for
 *  v1 (the user can re-ask). A no-physics flag for viz solids is out of scope. */
export function layoutBarChart(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const [ax, , az] = anchor
  const xs = rowPositions(series.length, BAR_GAP, ax)
  const heights = normalizeHeights(series.map((p) => p.value ?? NaN))
  const specs: ObjectSpec[] = []
  series.forEach((p, i) => {
    const h = heights[i]
    specs.push({
      kind: 'box',
      position: [xs[i], round(h / 2), az],          // base on the floor
      size: BAR_WIDTH,                               // x/z footprint
      scale: [1, round(h / BAR_WIDTH), 1],           // Y stretched to height h
      color: p.color ?? '#5b8def',
      label: p.label,
    })
    // label panel just in front of the foot (toward the viewer = +z, slightly raised)
    const valuePart = p.value !== undefined ? ` ${p.value}` : ''
    specs.push({ kind: 'text', position: [xs[i], LABEL_DY, round(az + 0.4)], text: `${p.label}${valuePart}`, size: 0.6 })
  })
  if (title) {
    specs.push({ kind: 'text', position: [ax, round(MAX_BAR + TITLE_DY), az], text: title, size: 1.4, label: 'title' })
  }
  return specs
}

/** timeline: marker cubes resting on the floor in a left→right row (array order),
 *  each with a text label floating above. Like a bar chart with fixed-height
 *  markers — it conveys SEQUENCE/order rather than magnitude. Markers are small
 *  `box` solids resting on the floor (same physics note as bar_chart). */
export function layoutTimeline(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const [ax, , az] = anchor
  const xs = rowPositions(series.length, CARD_GAP, ax)
  const specs: ObjectSpec[] = []
  series.forEach((p, i) => {
    specs.push({ kind: 'box', position: [xs[i], round(MARKER / 2), az], size: MARKER, color: p.color ?? '#8d7bef', label: p.label })
    const cap = p.caption ? `\n${p.caption}` : ''
    specs.push({ kind: 'text', position: [xs[i], round(MARKER + LABEL_DY), az], text: `${p.label}${cap}`, size: 0.6 })
  })
  if (title) {
    specs.push({ kind: 'text', position: [ax, round(MARKER + LABEL_DY + TITLE_DY), az], text: title, size: 1.4, label: 'title' })
  }
  return specs
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/scene/visualize.test.ts`
Expected: PASS (all visualize tests).

- [ ] **Step 5: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts
git commit -m "feat(visualize): bar_chart + timeline box layouts (base-on-floor, spaced to rest)"
```

---

### Task 5: visualize_data tool + handler + agent instructions (TDD)

**Files:**
- Modify: `src/agent/tools.ts` (add the `visualize_data` schema)
- Modify: `src/agent/toolHandlers.ts` (add the `visualize_data` case + imports + `DEFAULT_ANCHOR`)
- Modify: `server/realtime.ts` (extend `INSTRUCTIONS`)
- Test: `src/scene/store.test.ts` (append a handler describe block)

- [ ] **Step 1: Write the failing handler tests**

Append to the END of `src/scene/store.test.ts`:
```ts
describe('visualize_data handler', () => {
  it('spawns a grouped card row from a series and returns the groupId', async () => {
    const series = [
      { label: 'Mon', value: 24, secondary: 18, caption: 'cloudy' },
      { label: 'Tue', value: 26, secondary: 19, caption: 'sun' },
    ]
    const r = (await handleToolCall('visualize_data', { series, layout: 'card_row', title: 'Tokyo' })) as {
      ok: boolean; groupId: string; count: number; layout: string
    }
    expect(r.ok).toBe(true)
    expect(r.layout).toBe('card_row')
    // 2 cards + 1 title, all sharing the returned groupId
    const grouped = useScene.getState().objects.filter((o) => o.groupId === r.groupId)
    expect(grouped).toHaveLength(3)
    expect(r.count).toBe(3)
  })

  it('uses the heuristic when no layout is given (all-numeric → bar_chart)', async () => {
    const series = [{ label: 'A', value: 1 }, { label: 'B', value: 2 }]
    const r = (await handleToolCall('visualize_data', { series })) as { ok: boolean; layout: string }
    expect(r.ok).toBe(true)
    expect(r.layout).toBe('bar_chart')
  })

  it('errors on an empty series without spawning anything', async () => {
    const before = useScene.getState().objects.length
    const r = (await handleToolCall('visualize_data', { series: [] })) as { ok: boolean }
    expect(r.ok).toBe(false)
    expect(useScene.getState().objects.length).toBe(before)
  })
})
```
(`handleToolCall` and `useScene` are already imported at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/scene/store.test.ts -t "visualize_data handler"`
Expected: FAIL — the tool isn't handled, so it falls to the default MCP-forwarding case (which will try to fetch and error), not the expected grouped spawn.

- [ ] **Step 3: Add the tool schema**

In `src/agent/tools.ts`, add this entry to the `TOOL_DEFINITIONS` array (place it right before the `list_scene` entry):
```ts
  {
    type: 'function',
    name: 'visualize_data',
    description:
      'Turn a set of data points into a visual in the space — a row of cards, a bar chart, a timeline, or a single big stat. Use this to SHOW data you have (e.g. a weather forecast you just looked up, or numbers you know) instead of only saying it. Provide the data as `series`; pick a `layout` that fits, or omit it to let a sensible one be chosen. Optionally add a `title`. Returns a groupId you can use to remove or move the whole visualization later.',
    parameters: {
      type: 'object',
      properties: {
        series: {
          type: 'array',
          description: 'The data points to show, in order.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short label for this point, e.g. "Mon".' },
              value: { type: 'number', description: 'Primary number — bar height / the stat figure.' },
              secondary: { type: 'number', description: 'A second number to show (e.g. a low temperature).' },
              caption: { type: 'string', description: 'Short qualitative text, e.g. "partly cloudy".' },
              color: { type: 'string', description: 'Optional CSS color for this point.' },
            },
            required: ['label'],
          },
        },
        layout: {
          type: 'string',
          enum: ['card_row', 'bar_chart', 'timeline', 'stat'],
          description: 'How to lay it out. Omit to let a fitting layout be chosen automatically.',
        },
        title: { type: 'string', description: 'Optional heading shown above the visualization.' },
        position,
      },
      required: ['series'],
    },
  },
```
(Note: `position` is the shared helper object already defined at the top of `tools.ts` — reuse it, don't redefine.)

- [ ] **Step 4: Add the handler case**

In `src/agent/toolHandlers.ts`:

(a) Add the import near the other scene imports at the top:
```ts
import {
  layoutCardRow, layoutBarChart, layoutTimeline, layoutStat, pickLayout, MAX_POINTS,
  type DataPoint, type Layout, type Vec3,
} from '../scene/visualize'
```

(b) Add a module-level constant near the top of the file (after the imports):
```ts
// Where a visualization is anchored when the agent doesn't give a position: a
// single point straight ahead at panel height. Bar/timeline layouts ignore the y
// (their objects sit on the floor) and only use the x/z to centre the row.
const DEFAULT_ANCHOR: Vec3 = [0, 1.3, -2.5]
```

(c) Add this case to the `switch (name)` in `handleToolCall`, right before `case 'list_scene':`
```ts
    case 'visualize_data': {
      // The agent supplies the data inline (see the visualize_data spec). We
      // validate loosely — the model may send extra or missing fields — then pick
      // a layout (explicit or heuristic), lay the points out via the pure module,
      // and spawn every resulting object under one fresh groupId so the whole
      // visualization can later be removed/moved as a unit.
      const rawSeries = Array.isArray((args as { series?: unknown }).series)
        ? ((args as { series: unknown[] }).series)
        : []
      const series: DataPoint[] = rawSeries
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({
          label: String((p as { label?: unknown }).label ?? ''),
          value: typeof p.value === 'number' ? p.value : undefined,
          secondary: typeof p.secondary === 'number' ? p.secondary : undefined,
          caption: typeof p.caption === 'string' ? p.caption : undefined,
          color: typeof p.color === 'string' ? p.color : undefined,
        }))
        .slice(0, MAX_POINTS)
      if (series.length === 0) {
        return { ok: false, error: 'Provide a non-empty series of data points to visualize.', scene: scene.summary() }
      }
      const truncated = rawSeries.length > MAX_POINTS
      // Honour an explicit layout only if it's one we support; otherwise let the
      // heuristic decide (this is "the agent decides how to visualize" fallback).
      const requested = typeof args.layout === 'string' ? (args.layout as string) : undefined
      const layout: Layout =
        requested === 'card_row' || requested === 'bar_chart' || requested === 'timeline' || requested === 'stat'
          ? requested
          : pickLayout(series)
      const title = typeof args.title === 'string' ? args.title : undefined
      const pos = (args as { position?: { x: number; y: number; z: number } }).position
      const anchor: Vec3 = pos ? [pos.x, pos.y, pos.z] : DEFAULT_ANCHOR
      const specs =
        layout === 'card_row' ? layoutCardRow(series, anchor, title)
        : layout === 'bar_chart' ? layoutBarChart(series, anchor, title)
        : layout === 'timeline' ? layoutTimeline(series, anchor, title)
        : layoutStat(series, anchor, title)
      // One group id ties the whole visualization together.
      const groupId = useScene.getState().nextGroupId()
      for (const s of specs) {
        useScene.getState().spawn({
          kind: s.kind,
          position: { x: s.position[0], y: s.position[1], z: s.position[2] },
          size: s.size,
          color: s.color,
          text: s.text,
          scale: s.scale,
          label: s.label,
          groupId,
        })
      }
      useScene.getState().toast(`visualized ${series.length} points as ${layout}`)
      return { ok: true, groupId, count: specs.length, layout, truncated, scene: useScene.getState().summary() }
    }
```

- [ ] **Step 5: Extend the agent instructions**

In `server/realtime.ts`, inside the `INSTRUCTIONS` template literal, add this paragraph right after the `look_at_scene` paragraph (the one ending "…not after every action.") and before the new MCP/"outside world" paragraph added in Spec 1:
```
You can also SHOW data, not just say it: visualize_data turns a set of data points into a visual in
the space — a row of cards, a bar chart, a timeline, or one big stat. After you look something up
(like a weather forecast), offer to chart it; build the series from what you found and pick a layout
that fits, or let one be chosen. It returns a group you can later move or delete (e.g. "clear that
chart") — reference it by the group id from the scene summary.
```

- [ ] **Step 6: Run the handler tests + typecheck**

Run: `npx vitest run src/scene/store.test.ts -t "visualize_data handler"`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 8: Commit**

```bash
git add src/agent/tools.ts src/agent/toolHandlers.ts server/realtime.ts src/scene/store.test.ts
git commit -m "feat(visualize): visualize_data tool + handler + agent instructions"
```

---

### Task 6: Docs, full verification, deploy, in-headset test, PR

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Update STATUS.md**

Make these edits to `STATUS.md`:
- In **Agent tools**, add `visualize_data` to the list: "**`visualize_data`** — turn an agent-supplied data series into a grouped set of 3D objects (card_row / bar_chart / timeline / stat); the agent picks the layout if unspecified. Reuses text/box renderers; objects share a `groupId`."
- In **Repo map**, add a row: `| `src/scene/visualize.ts` | Pure layout engine: series → ObjectSpec[] for each template (+ pickLayout/normalizeHeights); heavily commented (expected to evolve) |`
- Add a note under the store row that `SceneObject.groupId` + `removeGroup`/`nextGroupId` group a visualization so it can be cleared/moved as a unit.
- In **Not done yet / next steps**, update the Effort B bullet: Spec 2 (Visualization) **DONE**; Specs 3 (Admin Console) + 4 (Skills) remain.

- [ ] **Step 2: Full local verification**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck clean, all tests pass, build emits `dist/` (large-chunk warning expected).

- [ ] **Step 3: Commit the docs**

```bash
git add STATUS.md
git commit -m "docs: STATUS — visualize_data + grouping (Effort B, spec 2)"
```

- [ ] **Step 4: Deploy**

Run: `./scripts/deploy.sh`
Expected: build + restart + health check OK.

- [ ] **Step 5: Manual verification — desktop Chrome**

Open https://armchair-sparkle.exe.xyz/, start talking:
- "What's the weather in Tokyo this week?" → it speaks the forecast (Spec 1).
- "Show me that as a chart." → a bar chart of bars stands in front; labels beneath.
- "Show it as cards instead." → a row of cards (the old group can be cleared/replaced).
- "Clear that chart." → the visualization disappears as a unit.
`./scripts/logs.sh 100` shows the `visualize_data` tool call.

- [ ] **Step 6: Manual verification — Quest**

In the Quest Browser, Enter VR, repeat the weather→chart flow. Confirm the chart reads well at human scale and bars stand stably on the floor (tune constants at the top of `visualize.ts` + redeploy if spacing/heights feel off).

- [ ] **Step 7: Open the PR**

```bash
git push -u origin effort-b-visualization
gh pr create --title "Effort B · Spec 2 — Data Visualization (visualize_data)" --body "Adds visualize_data: turns an agent-supplied data series into a grouped set of 3D objects via four pure layout templates (card_row/bar_chart/timeline/stat). Light groupId grouping so a viz is one manageable unit. Pure, heavily-commented layout engine in src/scene/visualize.ts. Spec: docs/superpowers/specs/2026-06-13-visualization-design.md. Awaiting in-VR verify before merge."
```
Expected: PR opened against `main`. (Edit PRs on ascii27/ideation with `gh api PATCH`, not `gh pr edit`.)

---

## Notes for the implementer

- **Pure module first, then wire it.** Tasks 2–4 build `src/scene/visualize.ts` with zero store/React coupling — all the layout math is unit-tested in isolation. Task 5 only validates input, picks a layout, and spawns. Keep it that way.
- **Heavy comments are a requirement here** (the user will refactor this a lot). The code blocks above already include them — preserve them verbatim; don't trim.
- **Bars are physics solids.** They're positioned base-on-floor and spaced wider than their width so they rest stably without colliding. Don't "fix" this by removing physics — that's a deliberate v1 choice noted in the code.
- **`src/` imports omit `.ts`**; `server/realtime.ts` (Task 5 step 5) is server code but you're only editing a string literal there, no new import.
