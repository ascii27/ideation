# Visualization Organization + No-Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `visualize_data` charts organized (no overlapping panels), stable (objects don't drift), and accumulate as a side-by-side gallery instead of piling up.

**Architecture:** Three independent fixes. (1) A per-object `noPhysics` flag plus a pure `participatesInPhysics` helper lets viz objects skip the physics rigid body and stay where placed (still grabbable). (2) `TextBody` honors `obj.size`, and the pure layout engine gains `panelWidth` + `spreadByWidth` so text rows are laid out edge-to-edge and never overlap. (3) A pure `galleryAnchor` plus a live-group count in the handler offsets each new chart along +x.

**Tech Stack:** TypeScript, React Three Fiber + drei (`<Text>`), Zustand store, Vitest. Pure layout math lives in `src/scene/visualize.ts` (unit-tested); renderer/store/handler changes are verified by `npm run typecheck` + `npm test` + in-headset.

## Global Constraints

- **Keep `src/scene/visualize.ts` pure** — no React/three/store imports; data in, data out. It is heavily commented and expected to evolve; keep that style.
- **No new layouts, no renderer rework** beyond honoring `size`. This is organization + physics only.
- **`noPhysics` is opt-in** — default behavior of all existing (non-viz) objects must be unchanged.
- **Text default size stays 1** so existing `create_text_panel` panels render identically after `TextBody` honors `size`.
- Server runs TS via `tsx`; client built by `vite`. Verify with `npm run typecheck && npm test && npm run build`. No local acceptance testing — deploy to the VM and verify in-headset.
- Commit messages end with the repo's `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## Task 1: Per-object physics opt-out

**Files:**
- Modify: `src/scene/types.ts` (add `noPhysics` to `SceneObject`)
- Modify: `src/scene/store.ts:22-34` (add `noPhysics` to `SpawnArgs`), `src/scene/store.ts:160-181` (pass it through in `spawn`)
- Modify: `src/scene/geometry.ts` (add `participatesInPhysics`)
- Modify: `src/xr/SceneObjects.tsx:35` (import), `src/xr/SceneObjects.tsx:130` (use it)
- Test: `src/scene/geometry.test.ts`

**Interfaces:**
- Produces: `participatesInPhysics(kind: ObjectKind, noPhysics?: boolean): boolean` in `geometry.ts`; `SceneObject.noPhysics?: boolean`; `SpawnArgs.noPhysics?: boolean`.
- Consumes: existing `isSolidKind(kind)` from `geometry.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/scene/geometry.test.ts` (and add `participatesInPhysics` to the existing `./geometry` import at the top of the file):

```ts
describe('participatesInPhysics', () => {
  it('simulates solids that are not opted out', () => {
    expect(participatesInPhysics('box')).toBe(true)
    expect(participatesInPhysics('sphere')).toBe(true)
    expect(participatesInPhysics('model')).toBe(true)
  })

  it('never simulates panels or ground', () => {
    expect(participatesInPhysics('text')).toBe(false)
    expect(participatesInPhysics('image')).toBe(false)
    expect(participatesInPhysics('ground')).toBe(false)
  })

  it('opts a solid out of physics when noPhysics is set', () => {
    expect(participatesInPhysics('box', true)).toBe(false)
    expect(participatesInPhysics('model', true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/geometry.test.ts -t participatesInPhysics`
Expected: FAIL — `participatesInPhysics is not exported` / not defined.

- [ ] **Step 3: Add the helper**

In `src/scene/geometry.ts`, immediately after `isSolidKind` (around line 44):

```ts
/** Whether an object is simulated by physics. Solids (primitives + models) are —
 *  UNLESS individually opted out via `noPhysics`. Visualization objects set the
 *  flag so a chart stays exactly where its layout placed it (it falls through to
 *  the grabbable, non-simulated path). Panels/ground are never solids. */
export function participatesInPhysics(kind: ObjectKind, noPhysics?: boolean): boolean {
  return isSolidKind(kind) && !noPhysics
}
```

- [ ] **Step 4: Add the `noPhysics` field through the store**

In `src/scene/types.ts`, add to `SceneObject` (after `groupId`, before the closing brace at line 80):

```ts
  /** When true, this solid is NOT simulated (no gravity/collision) but stays
   *  grabbable — set by visualize_data so chart objects don't drift. */
  noPhysics?: boolean
```

In `src/scene/store.ts`, add to `SpawnArgs` (after `groupId?` at line 33):

```ts
  /** Opt this object out of physics simulation (see SceneObject.noPhysics). */
  noPhysics?: boolean
```

In `src/scene/store.ts`, pass it through in `spawn` (in the `obj` literal, after `groupId: args.groupId,` at line 180):

```ts
      noPhysics: args.noPhysics,
```

- [ ] **Step 5: Wire the renderer**

In `src/xr/SceneObjects.tsx`, add `participatesInPhysics,` to the `from '../scene/geometry'` import block (around line 35, alongside `isSolidKind`).

Then change line 130 from:

```ts
  const wrapped = isSolidKind(obj.kind) ? (
```

to:

```ts
  const wrapped = participatesInPhysics(obj.kind, obj.noPhysics) ? (
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/scene/geometry.test.ts -t participatesInPhysics && npm run typecheck`
Expected: PASS, and typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/scene/types.ts src/scene/store.ts src/scene/geometry.ts src/scene/geometry.test.ts src/xr/SceneObjects.tsx
git commit -m "feat(viz): per-object noPhysics flag + participatesInPhysics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Honor `size` on text panels + `panelWidth` helper

**Files:**
- Modify: `src/scene/visualize.ts` (add `panelWidth`, expose constants in `_CONST`)
- Modify: `src/xr/SceneObjects.tsx:561-583` (`TextBody` scales by `obj.size`)
- Test: `src/scene/visualize.test.ts`

**Interfaces:**
- Produces: `panelWidth(text: string, size?: number): number` in `visualize.ts` (defaults `size` to 1); new constants `LABEL_SIZE` and `PANEL_MARGIN` added to the existing exported `_CONST` object.
- Note: `panelWidth` MUST mirror `TextBody`'s width formula exactly: `clamp(text.length * 0.11, 1.2, 4) * size`.

- [ ] **Step 1: Write the failing test**

Add `panelWidth` to the `./visualize` import in `src/scene/visualize.test.ts`, then add this test inside the existing `describe('visualize core helpers', …)` block:

```ts
it('panelWidth mirrors the renderer clamp and scales by size', () => {
  expect(panelWidth('hi', 1)).toBeCloseTo(1.2)               // short text → min 1.2
  expect(panelWidth('x'.repeat(50), 1)).toBeCloseTo(4)        // long text → max 4
  expect(panelWidth('hi', 0.5)).toBeCloseTo(0.6)              // scaled by size
  expect(panelWidth('hi')).toBeCloseTo(1.2)                   // size defaults to 1
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/visualize.test.ts -t panelWidth`
Expected: FAIL — `panelWidth is not exported` / not defined.

- [ ] **Step 3: Add `panelWidth` and constants**

In `src/scene/visualize.ts`, add two constants in the tuning block (after `LABEL_DY` around line 50):

```ts
const LABEL_SIZE = 0.6     // size scale for bar/timeline value labels (small)
const PANEL_MARGIN = 0.4   // metres of clear space between adjacent panel edges
```

Update the `_CONST` export (line 97) to include them:

```ts
export const _CONST = { CARD_GAP, BAR_GAP, BAR_WIDTH, MIN_BAR, MAX_BAR, MARKER, TITLE_DY, LABEL_DY, LABEL_SIZE, PANEL_MARGIN }
```

Add the helper (place it near `rowPositions`, e.g. after line 65):

```ts
/** Rendered width (metres) of a text panel — mirrors TextBody in SceneObjects.tsx:
 *  a base width clamped to [1.2, 4] by text length, times the panel's size scale.
 *  Kept in lockstep with the renderer so the layout's spacing math matches what
 *  the user actually sees. */
export function panelWidth(text: string, size = 1): number {
  const base = Math.max(1.2, Math.min(4, text.length * 0.11))
  return round(base * size)
}
```

- [ ] **Step 4: Make `TextBody` honor `size`**

In `src/xr/SceneObjects.tsx`, change the `TextBody` outer group (line 565) from:

```tsx
    <group>
```

to:

```tsx
    <group scale={obj.size}>
```

(Default text `size` is 1 in the store, so existing panels are unchanged.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/scene/visualize.test.ts -t panelWidth && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts src/xr/SceneObjects.tsx
git commit -m "feat(viz): panelWidth helper + TextBody honors size

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Width-aware row spacing (`spreadByWidth`) for card_row + timeline

**Files:**
- Modify: `src/scene/visualize.ts` (`spreadByWidth`, rewrite `layoutCardRow` + `layoutTimeline`)
- Test: `src/scene/visualize.test.ts` (new `spreadByWidth` tests; update the card_row symmetry assertion)

**Interfaces:**
- Consumes: `panelWidth` (Task 2), `LABEL_SIZE`/`PANEL_MARGIN` constants (Task 2), existing `round`, `cardText`, `CARD_GAP`/`MARKER`/`LABEL_DY`/`TITLE_DY`.
- Produces: `spreadByWidth(widths: number[], gap: number, anchorX: number): number[]` — one centre x per panel, the whole row centred about `anchorX`, neighbours never overlapping.

- [ ] **Step 1: Write the failing tests**

Add `spreadByWidth` to the `./visualize` import in `src/scene/visualize.test.ts`. Add a new describe block:

```ts
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
```

Also update the existing card_row test (currently lines 58-74) — variable-width panels are no longer per-card symmetric. Replace the symmetry assertions:

```ts
    // centred: x positions symmetric about 0
    const xs = cards.map((s) => s.position[0])
    expect(xs[0]).toBeCloseTo(-xs[2])
    expect(xs[1]).toBeCloseTo(0)
```

with a whole-row centering + no-overlap check:

```ts
    // whole row centred about the anchor and panels don't overlap
    const xs = cards.map((s) => s.position[0])
    const ws = cards.map((s) => panelWidth(s.text ?? '', s.size ?? 1))
    const leftEdge = xs[0] - ws[0] / 2
    const rightEdge = xs[xs.length - 1] + ws[ws.length - 1] / 2
    expect(leftEdge).toBeCloseTo(-rightEdge)
    for (let i = 0; i < xs.length - 1; i++) {
      expect(xs[i + 1] - xs[i]).toBeGreaterThanOrEqual((ws[i] + ws[i + 1]) / 2 + _CONST.PANEL_MARGIN - 1e-9)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/scene/visualize.test.ts -t spreadByWidth`
Expected: FAIL — `spreadByWidth is not exported`.

- [ ] **Step 3: Add `spreadByWidth`**

In `src/scene/visualize.ts`, after `rowPositions` (around line 65):

```ts
/** Place variable-width panels in a row, centred about anchorX, with `gap` metres
 *  of clear space between neighbouring EDGES. Returns one centre x per panel.
 *  Unlike rowPositions (fixed centre-to-centre gap), this accounts for each
 *  panel's own width, so wide and narrow panels never overlap. */
export function spreadByWidth(widths: number[], gap: number, anchorX: number): number[] {
  if (widths.length === 0) return []
  const total = widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1)
  let edge = anchorX - total / 2   // left edge of the whole row
  return widths.map((w) => {
    const centre = round(edge + w / 2)
    edge += w + gap
    return centre
  })
}
```

- [ ] **Step 4: Rewrite `layoutCardRow` to use it**

Replace the body of `layoutCardRow` (lines 116-130) with:

```ts
export function layoutCardRow(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const [ax, ay, az] = anchor
  const texts = series.map(cardText)
  // cards render at default size 1; space them by their real rendered widths
  const xs = spreadByWidth(texts.map((t) => panelWidth(t, 1)), PANEL_MARGIN, ax)
  const specs: ObjectSpec[] = series.map((p, i) => ({
    kind: 'text',
    position: [xs[i], ay, az],
    text: texts[i],
    color: p.color,
    label: p.label,
  }))
  if (title) {
    specs.push({ kind: 'text', position: [ax, round(ay + TITLE_DY), az], text: title, size: 1.4, label: 'title' })
  }
  return specs
}
```

- [ ] **Step 5: Rewrite `layoutTimeline` to use it**

Replace the body of `layoutTimeline` (lines 186-199) with:

```ts
export function layoutTimeline(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const [ax, , az] = anchor
  // the label panels are the wide footprint; space markers to match them so
  // neither markers nor labels overlap.
  const labels = series.map((p) => `${p.label}${p.caption ? `\n${p.caption}` : ''}`)
  const xs = spreadByWidth(labels.map((t) => panelWidth(t, LABEL_SIZE)), PANEL_MARGIN, ax)
  const specs: ObjectSpec[] = []
  series.forEach((p, i) => {
    specs.push({ kind: 'box', position: [xs[i], round(MARKER / 2), az], size: MARKER, color: p.color ?? '#8d7bef', label: p.label })
    specs.push({ kind: 'text', position: [xs[i], round(MARKER + LABEL_DY), az], text: labels[i], size: LABEL_SIZE })
  })
  if (title) {
    specs.push({ kind: 'text', position: [ax, round(MARKER + LABEL_DY + TITLE_DY), az], text: title, size: 1.4, label: 'title' })
  }
  return specs
}
```

- [ ] **Step 6: Run the full visualize suite + typecheck**

Run: `npx vitest run src/scene/visualize.test.ts && npm run typecheck`
Expected: PASS (new spreadByWidth tests, updated card_row test, and the untouched timeline/stat tests all green).

- [ ] **Step 7: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts
git commit -m "feat(viz): width-aware spacing for card_row + timeline (no overlap)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Width-aware bar spacing for bar_chart

**Files:**
- Modify: `src/scene/visualize.ts` (rewrite `layoutBarChart`)
- Test: `src/scene/visualize.test.ts` (add a label-fit assertion)

**Interfaces:**
- Consumes: `panelWidth`, `LABEL_SIZE`, `PANEL_MARGIN`, `BAR_GAP`, `BAR_WIDTH`, `rowPositions`, `normalizeHeights`.
- Produces: `layoutBarChart` with the same signature; bars now use a uniform gap of `max(BAR_GAP, widestLabelWidth + PANEL_MARGIN)`, and labels render at `LABEL_SIZE`.

- [ ] **Step 1: Write the failing test**

Add to the `describe('box layouts', …)` block in `src/scene/visualize.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/visualize.test.ts -t "widens bar spacing"`
Expected: FAIL — current fixed `BAR_GAP` (0.55) is narrower than the label width, so the assertion fails.

- [ ] **Step 3: Rewrite `layoutBarChart`**

Replace the body of `layoutBarChart` (lines 157-180). Note the PHYSICS NOTE comment is replaced — bars no longer rely on gap/rest for stability because the handler sets `noPhysics`:

```ts
/** bar_chart: a row of box bars, height ∝ value (normalised across the series).
 *  HOW THE BAR IS BUILT: a unit box scaled by `size`=BAR_WIDTH gives a BAR_WIDTH
 *  cube; the Y `scale` then stretches it to the target height h (scaleY = h /
 *  BAR_WIDTH). We place its CENTRE at y = h/2 so the base sits on the floor. A
 *  small text label floats just in front of each bar's foot; the title floats
 *  above the tallest possible bar.
 *
 *  SPACING: bar centres use a uniform gap wide enough for the widest label
 *  (>= BAR_GAP so bars never touch). The visualize_data handler marks every bar
 *  noPhysics, so bars stay put regardless of gravity/grabs. */
export function layoutBarChart(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[] {
  const [ax, , az] = anchor
  const labelTexts = series.map((p) => `${p.label}${p.value !== undefined ? ` ${p.value}` : ''}`)
  const widest = Math.max(0, ...labelTexts.map((t) => panelWidth(t, LABEL_SIZE)))
  const gap = Math.max(BAR_GAP, round(widest + PANEL_MARGIN))
  const xs = rowPositions(series.length, gap, ax)
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
    specs.push({ kind: 'text', position: [xs[i], LABEL_DY, round(az + 0.4)], text: labelTexts[i], size: LABEL_SIZE })
  })
  if (title) {
    specs.push({ kind: 'text', position: [ax, round(MAX_BAR + TITLE_DY), az], text: title, size: 1.4, label: 'title' })
  }
  return specs
}
```

- [ ] **Step 4: Run the full visualize suite + typecheck**

Run: `npx vitest run src/scene/visualize.test.ts && npm run typecheck`
Expected: PASS. (The existing missing-value test asserts a value-less label is exactly `"B"` — preserved here. Single-point bar still centres on x=0 because `rowPositions(1, gap, 0) === [0]`.)

- [ ] **Step 5: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts
git commit -m "feat(viz): width-aware bar spacing + small labels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Gallery placement + stamp `noPhysics` in the handler

**Files:**
- Modify: `src/scene/visualize.ts` (add `galleryAnchor` + `GALLERY_STEP`)
- Modify: `src/agent/toolHandlers.ts:5-8` (import `galleryAnchor`), `:328-348` (live-group offset + `noPhysics`)
- Test: `src/scene/visualize.test.ts` (galleryAnchor)

**Interfaces:**
- Produces: `galleryAnchor(base: Vec3, index: number): Vec3` — `base` shifted +x by `index * GALLERY_STEP`; `GALLERY_STEP` added to `_CONST`.
- Consumes (handler): `galleryAnchor`, existing `useScene.getState().objects`, `DEFAULT_ANCHOR`, `nextGroupId`, `spawn` (now accepting `noPhysics`).

- [ ] **Step 1: Write the failing test**

Add `galleryAnchor` to the `./visualize` import (and `type Vec3`) in `src/scene/visualize.test.ts`. Add to `describe('visualize core helpers', …)`:

```ts
it('galleryAnchor marches successive vizzes along +x', () => {
  const base: Vec3 = [0, 1.3, -2.5]
  expect(galleryAnchor(base, 0)).toEqual([0, 1.3, -2.5])
  expect(galleryAnchor(base, 1)).toEqual([_CONST.GALLERY_STEP, 1.3, -2.5])
  expect(galleryAnchor(base, 2)).toEqual([_CONST.GALLERY_STEP * 2, 1.3, -2.5])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/visualize.test.ts -t galleryAnchor`
Expected: FAIL — `galleryAnchor is not exported`.

- [ ] **Step 3: Add `galleryAnchor` + constant**

In `src/scene/visualize.ts`, add the constant in the tuning block (after `PANEL_MARGIN`):

```ts
const GALLERY_STEP = 4  // metres between successive visualization anchors (march +x)
```

Add it to `_CONST`:

```ts
export const _CONST = { CARD_GAP, BAR_GAP, BAR_WIDTH, MIN_BAR, MAX_BAR, MARKER, TITLE_DY, LABEL_DY, LABEL_SIZE, PANEL_MARGIN, GALLERY_STEP }
```

Add the helper (near `rowPositions`):

```ts
/** Anchor for the Nth simultaneous visualization (0-based): the base anchor
 *  shifted +x by index * GALLERY_STEP, so charts line up side-by-side like panels
 *  on a wall instead of stacking on each other. */
export function galleryAnchor(base: Vec3, index: number): Vec3 {
  return [round(base[0] + index * GALLERY_STEP), base[1], base[2]]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scene/visualize.test.ts -t galleryAnchor`
Expected: PASS.

- [ ] **Step 5: Wire the handler**

In `src/agent/toolHandlers.ts`, add `galleryAnchor,` to the import from `'../scene/visualize'` (line 6).

Replace the anchor line (currently line 328-329):

```ts
      const pos = (args as { position?: { x: number; y: number; z: number } }).position
      const anchor: Vec3 = pos ? [pos.x, pos.y, pos.z] : DEFAULT_ANCHOR
```

with gallery placement:

```ts
      const pos = (args as { position?: { x: number; y: number; z: number } }).position
      // Gallery placement: with no explicit position, offset each new viz beside
      // the existing ones — one slot per live group — so they don't pile up.
      // Clearing a group frees its slot (the next viz fills the gap).
      const liveGroups = new Set(
        useScene.getState().objects.filter((o) => o.groupId).map((o) => o.groupId),
      ).size
      const anchor: Vec3 = pos ? [pos.x, pos.y, pos.z] : galleryAnchor(DEFAULT_ANCHOR, liveGroups)
```

In the spawn loop (lines 337-348), add `noPhysics: true` to the spawn args (after `groupId,`):

```ts
        useScene.getState().spawn({
          kind: s.kind,
          position: { x: s.position[0], y: s.position[1], z: s.position[2] },
          size: s.size,
          color: s.color,
          text: s.text,
          scale: s.scale,
          label: s.label,
          groupId,
          noPhysics: true,
        })
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests PASS, typecheck clean, build succeeds (large-chunk warnings are expected/ignored).

- [ ] **Step 7: Commit**

```bash
git add src/scene/visualize.ts src/scene/visualize.test.ts src/agent/toolHandlers.ts
git commit -m "feat(viz): gallery placement + viz objects are noPhysics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Deploy + in-headset verification

**Files:** none (verification only). Update `STATUS.md` if behavior notes need refreshing.

- [ ] **Step 1: Deploy**

Run: `./scripts/deploy.sh`
Expected: rsync + remote install/build + service restart + health check all succeed.

- [ ] **Step 2: Verify in the Quest (and/or desktop Chrome for the voice path)**

Open https://armchair-sparkle.exe.xyz/, enter VR, and exercise each layout via voice (use `./scripts/logs.sh -f` to watch tool calls):
- "show me Tokyo's weather this week as a chart" → **bar_chart**: bars in a clean row, labels below not overlapping, **bars do not fall or drift**.
- "show it as cards" → **card_row**: panels spaced apart, no overlap.
- "show these milestones as a timeline" → **timeline**: markers + labels evenly spaced.
- Ask for a second visualization → it appears **beside** the first, not on top.
- "clear that chart" → removes one group; the next new viz reuses the freed slot.

Expected: organized, stable, side-by-side. If spacing feels off, tune `PANEL_MARGIN` / `GALLERY_STEP` / `LABEL_SIZE` at the top of `src/scene/visualize.ts` and redeploy.

- [ ] **Step 3: Commit any STATUS/tuning updates**

```bash
git add -A
git commit -m "docs(viz): STATUS — organization + no-physics verified in-headset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Physics opt-out (spec §1) → Task 1 (flag + helper + renderer) and Task 5 (handler stamps it). ✓
- Honor `size` in TextBody (spec §2) → Task 2. ✓
- `panelWidth` (spec §2) → Task 2. ✓
- `spreadByWidth` + card_row/timeline (spec §2) → Task 3. ✓
- bar_chart width-aware gap (spec §2) → Task 4. ✓
- Gallery placement + live-group count + explicit-position override (spec §3) → Task 5. ✓
- Testing (spec): panelWidth, no-overlap invariant, bar-gap-fits-label, gallery offset, participatesInPhysics → Tasks 1–5. ✓
- In-headset re-verification (spec) → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `participatesInPhysics(kind, noPhysics?)`, `panelWidth(text, size?)`, `spreadByWidth(widths, gap, anchorX)`, `galleryAnchor(base, index)`, and `_CONST.{LABEL_SIZE,PANEL_MARGIN,GALLERY_STEP}` are named identically in their producing task and every consumer. `SceneObject.noPhysics` / `SpawnArgs.noPhysics` match. ✓
