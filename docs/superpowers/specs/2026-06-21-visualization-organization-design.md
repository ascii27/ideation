# Visualization organization + no-physics design

_Design spec — 2026-06-21. A follow-up refinement to **Spec 2 of Effort B (Data Visualization)**
([2026-06-13-visualization-design.md](2026-06-13-visualization-design.md), implemented on
`effort-b-visualization` / PR #14). In-headset testing surfaced three organization problems; this
spec fixes them without adding layouts or reworking the renderer._

## Context

`visualize_data` turns an agent-supplied `series` into a **grouped** set of 3D objects via the pure
layout engine `src/scene/visualize.ts` (templates `card_row` / `bar_chart` / `timeline` / `stat`).
The feature works, but in the headset it looks disorganized and the chart objects drift. Three
distinct causes were confirmed by reading the code:

1. **Physics drift.** `bar_chart` and `timeline` emit `kind: 'box'` objects. `SceneObjects.tsx`
   wraps every solid (`isSolidKind`) in a physics rigid body — there is no per-object opt-out — so
   bars/markers respond to gravity and can be knocked out of their row.
2. **Within-viz overlap.** `TextBody` (`src/xr/SceneObjects.tsx`) **ignores `obj.size`**: every text
   panel renders at `clamp(text.length × 0.11, 1.2, 4)` m wide regardless of the `size` the layout
   passes. Bar labels meant to be `size 0.6` render ≥1.2 m wide but sit only `BAR_GAP` 0.55 m apart,
   so they overlap heavily. Closely-spaced cards overlap for the same reason.
3. **Pile-up.** The handler always spawns at the fixed `DEFAULT_ANCHOR [0, 1.3, -2.5]`, so every
   `visualize_data` call stacks on top of the previous one.

## Goal

Visualizations that are **organized** (no overlapping panels, predictable spacing) and **stable**
(objects stay exactly where the layout places them), and that **accumulate as a gallery** rather
than piling up — while remaining grabbable so the user can rearrange them by hand.

### Decisions (from brainstorming)

- **Multiple visualizations = gallery.** A new `visualize_data` call (with no explicit position)
  spawns offset to the side of existing ones, like panels on a wall. Nothing is auto-removed; the
  user clears a chart by group as before.
- **Viz objects are non-physical but grabbable.** They never fall or collide, but the user can still
  grab and reposition them (they flow through `GrabbableObject`, like text/image panels).
- **`size` becomes meaningful for text panels.** Today it is silently ignored; making it a real
  scale multiplier (default 1, so existing panels are unchanged) is what lets the layout shrink
  labels and grow titles.
- **No new layouts, no renderer rework** beyond honoring `size`. Purely organization + physics.

## Design

### 1. Per-object physics opt-out

- Add `noPhysics?: boolean` to `SceneObject` (`src/scene/types.ts`) and `SpawnArgs`
  (`src/scene/store.ts`); thread it through `spawn` (default `undefined` ≡ false).
- Extract a pure helper into `src/scene/geometry.ts`:
  `participatesInPhysics(kind, noPhysics) === isSolidKind(kind) && !noPhysics`.
- `src/xr/SceneObjects.tsx:130` uses `participatesInPhysics(obj.kind, obj.noPhysics)` instead of
  `isSolidKind(obj.kind)`. A non-physics box falls through to `GrabbableObject` → no gravity, no
  collision, stays put, still grabbable.
- The `visualize_data` handler stamps `noPhysics: true` on **every** object it spawns in the group
  (harmless on text panels, decisive for boxes).

### 2. No overlap within a viz

- **Honor `size` in `TextBody`:** scale the whole panel group by `obj.size` (default 1). Text's
  default size is already 1 (`store.ts`), so existing `create_text_panel` panels render identically;
  only layout-supplied sizes (stat `2`, title `1.4`, labels `0.6`) now take effect.
- **`panelWidth(text, size)`** — new pure helper in `visualize.ts` mirroring the renderer's width
  formula: `clamp(text.length × 0.11, 1.2, 4) × size`. Single source of truth shared by tests.
- **`spreadByWidth(widths, gap, anchorX)`** — new pure positioner that lays panels edge-to-edge with
  a fixed margin (`gap`) between them, centred about `anchorX`. Returns one x per panel. Guarantees
  adjacent panels never overlap regardless of label length. `card_row` and `timeline` use it for
  their panels (replacing the fixed-gap `rowPositions` where panels are the dominant footprint).
- **bar_chart:** compute the bars' x-spacing as `max(BAR_GAP, widestLabelWidth + margin)` so the
  (now-small) labels under the bars don't overlap and bars stay aligned with their labels. Bars
  themselves keep `BAR_WIDTH`; only the gap grows when labels demand it.

### 3. Gallery placement

- When the agent gives no explicit `position`, the chart takes the **lowest free gallery slot**:
  `anchorX = DEFAULT_ANCHOR.x + slot × GALLERY_STEP` (slots march right from 0). First chart in slot 0,
  the next free slot for each subsequent chart.
- Each spawned object carries its `vizSlot`; the free slot is the lowest non-negative integer not
  among the live objects' `vizSlot`s (pure `nextFreeSlot` helper). Because a cleared group's objects
  vanish, **clearing any chart — not just the most recent — frees its exact slot** for the next chart
  to reuse (a plain group *count* would stack the next chart on a survivor after an interior clear).
- An explicit `position` argument still overrides the gallery offset entirely (and occupies no slot).
- `GALLERY_STEP` is a tuning constant at the top of `visualize.ts` (≈ widest expected viz width,
  start ~4 m), adjustable in-headset.

## Testing

`visualize.ts` stays pure → unit tests in `visualize.test.ts`:
- `panelWidth` matches the renderer formula at representative lengths and sizes.
- **No-overlap invariant:** for `spreadByWidth`, every adjacent centre pair satisfies
  `|xᵢ₊₁ − xᵢ| ≥ (wᵢ + wᵢ₊₁)/2 + margin`.
- bar_chart gap accommodates the widest label (`gap ≥ widestLabelWidth + margin`).
- Gallery offset: anchor x increases by `GALLERY_STEP` per existing group; explicit position wins.
- `participatesInPhysics` in `geometry.test.ts`: true for solids without the flag, false for
  text/image/ground and for any kind with `noPhysics`.

All four templates re-verified in-headset after `./scripts/deploy.sh`; constants at the top of
`visualize.ts` remain the in-headset tuning knobs.

## Out of scope

New chart types, axis lines / gridlines, animated transitions, a "replace previous viz" mode
(gallery is the chosen default), and any change to how non-viz objects behave (the `noPhysics` flag
is opt-in; existing objects are untouched).
