# Data Visualization design

_Design spec — 2026-06-13. Spec 2 of **Effort B (external data integrations)**. Adds a
`visualize_data` agent tool that turns a structured data series the agent holds into a **grouped**
set of 3D objects, via a small library of layout templates. This is the VR payoff for Spec 1 (the
MCP Hub): the agent can now **fetch** live data (Spec 1) and **show** it in the space (this spec)._

## Context — where this sits in Effort B

Effort B ("The Connected Agent") is 4 specs: **(1) MCP Hub** — done/merged (the agent fetches and
*speaks* live data); **(2) Visualization** _(this spec)_ — turn that data into objects; **(3) Admin
Console**; **(4) Skills**. Spec 1 already returns tool results to the model as JSON the agent can
see. This spec consumes that: the agent maps what it saw into a `series` and calls `visualize_data`.

## Goal

Today the agent can describe data out loud but can't render it spatially. `visualize_data` takes a
structured series the agent constructs (from a Spec-1 tool result, or its own knowledge) plus a
chosen layout, and spawns a labeled, **grouped** arrangement of existing object kinds (text panels,
boxes) positioned by tested layout math. The agent picks the representation when the person doesn't
specify one.

Verified in-headset: *"show me Tokyo's weather this week as a chart"* → a labeled bar chart appears
in front of the user; *"clear that chart"* removes it as a unit.

### Decisions (from brainstorming)
- **Data input = agent passes structured points inline.** `visualize_data(series, …)` where the
  agent builds `series` from data it already has. Keeps the tool **decoupled from MCP** — it
  visualizes *any* data the agent holds, not just tool results — and needs no server-side state.
  Transcription risk at ~7–24 points is acceptable; server-side "data handles" are explicitly
  deferred (YAGNI).
- **Four layout templates in v1:** `card_row`, `bar_chart`, `timeline`, `stat`. Each is a pure
  function mapping the same `series` to object specs.
- **Agent chooses the layout**; if it omits `layout`, a handler-side **heuristic** picks one
  (`pickLayout`). This is what "the agent decides how to visualize if I don't specify" means.
- **Light `groupId` grouping.** Each spawned object carries a `groupId` (e.g. `viz-1`); the store
  can remove/move a whole group; individual objects stay grabbable/editable. Lets the agent
  "clear/move that chart" and replace an old viz on a repeat request. (No composite object kind.)
- **Reuse existing object kinds** (`text`, `box`) — no new renderer. Layout math positions them.
- **Layout math lives in a new pure module** `src/scene/visualize.ts` (like `geometry.ts`),
  unit-tested, not grown into `geometry.ts`.

### Code style — heavy comments (explicit user requirement)
This subsystem is expected to be **refactored a lot**. Per the user, the implementation MUST carry
**generous, design-explaining comments** — not terse what-it-does notes, but the *intent*: why each
template maps the series the way it does, what the layout/coordinate math computes, how `groupId`
ties objects into a unit, and the contract of each pure function. This overrides the usual
"match surrounding comment density" rule **for `src/scene/visualize.ts` and the new handler/tool
code**. (Recorded as a standing preference.)

## Data flow

```
Agent (voice) ──visualize_data{series, layout?, title?, position?}──▶ handleToolCall (browser)
   case 'visualize_data':
     ├─ validate series (non-empty; cap at MAX_POINTS)
     ├─ layout = args.layout ?? pickLayout(series)            [src/scene/visualize.ts, pure]
     ├─ anchor = position ?? inFrontOfUser()                  [reuse existing default placement]
     ├─ specs  = layout fn (series, anchor, title)            [pure → ObjectSpec[]]
     ├─ groupId = nextGroupId()  (e.g. "viz-1")
     ├─ for each spec: scene.spawn({ ...spec, groupId })      [store; existing renderers draw it]
     └─ returns { ok, groupId, count, layout, scene } ──▶ function_call_output ──▶ agent speaks it
```

No async/network — this is a synchronous, in-store operation (unlike image/model/texture tools).

## The `series` contract

A point is intentionally small and flexible enough to feed all four templates:
```ts
interface DataPoint {
  label: string       // x-axis / card title, e.g. "Mon" or "Tokyo"
  value?: number      // primary numeric — bar height, the stat number, timeline ordering hint
  secondary?: number  // a second figure cards show (e.g. the low temp)
  caption?: string    // qualitative text, e.g. "partly cloudy"
  color?: string      // optional per-point CSS color override
}
```
Weather example: `{ label:"Mon", value:24, secondary:18, caption:"partly cloudy" }`.

## Components

### 1. Pure layout module — `src/scene/visualize.ts` (unit-tested, heavily commented)

This module **owns and exports** the core types — `DataPoint` (the series contract above),
`Vec3 = [number, number, number]`, `ObjectSpec` (a partial `SpawnArgs`-shaped record the handler can
spawn), and `Layout` — plus the four layout functions, the heuristic (`pickLayout`), and the
height-normalizer (`normalizeHeights`). The tool/handler import `DataPoint`/`Layout` from here. No
React/three imports — pure data in, pure data out.

```ts
type Vec3 = [number, number, number]

// An object the handler will spawn. A loose subset of the store's SpawnArgs.
export interface ObjectSpec {
  kind: 'text' | 'box'
  position: [number, number, number]
  size?: number
  color?: string
  text?: string                 // for kind:'text'
  scale?: [number, number, number]  // for kind:'box' bar heights
  label?: string
}

export type Layout = 'card_row' | 'bar_chart' | 'timeline' | 'stat'

/** Choose a layout from the data shape when the agent didn't specify one:
 *  1 point → 'stat'; every point has a numeric `value` → 'bar_chart'; else 'card_row'. */
export function pickLayout(series: DataPoint[]): Layout

/** Map values to bar heights in meters within [MIN_BAR, MAX_BAR], scaled across the
 *  series' own min..max (a flat series → all MAX_BAR). Returns one height per value. */
export function normalizeHeights(values: number[]): number[]

// Each layout fn: (series, anchor, title?) → ObjectSpec[]. `anchor` is the world-space
// center-front of the viz; the fn lays objects out relative to it (centered on x).
export function layoutCardRow(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[]
export function layoutBarChart(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[]
export function layoutTimeline(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[]
export function layoutStat(series: DataPoint[], anchor: Vec3, title?: string): ObjectSpec[]
```

Template behavior (each reuses existing kinds):
- **card_row** — a horizontal row of `text` panels (one per point), centered on the anchor, evenly
  spaced (`CARD_GAP`). Each panel's text is multi-line: `label` / `value`·`secondary` / `caption`
  (omitting absent fields). Title (if given) → a larger `text` panel above the row.
- **bar_chart** — a row of `box` bars; bar height = `normalizeHeights(values)`, applied as a Y
  `scale` so a unit box stretches up from the floor; each bar sits at floor level (y from base), with
  a small `text` label panel beneath showing `label` (+ value). `color` per point or a default.
- **timeline** — points along a horizontal axis line (a thin `box` as the axis, or evenly spaced
  marker boxes), each with a `text` label; ordered left→right by array order.
- **stat** — the first point only: one large `text` panel (`value` big + `caption`/`label` under it).

Constants at the top (`MIN_BAR`, `MAX_BAR`, `CARD_GAP`, `BAR_GAP`, `ROW_HEIGHT`, `MAX_POINTS`) so
tuning in-headset is a one-line change — commented with what each affects.

### 2. Store: grouping — `src/scene/store.ts` + `src/scene/types.ts`

- `types.ts`: add `groupId?: string` to `SceneObject` (a tag; objects without it are ungrouped).
- `store.ts`: `SpawnArgs` accepts an optional `groupId` (threaded onto the spawned object);
  add `removeGroup(groupId: string): number` (removes all objects with that id, returns the count)
  and `nextGroupId(): string` (monotonic `viz-1`, `viz-2`, … like the per-kind id counter).
  `summary()` is extended to note groups (e.g. "weather chart (viz-1): 7 bars") so the agent can
  reference a whole viz. Grab/move/update of individual members is unchanged.

### 3. Tool — `visualize_data` (`src/agent/tools.ts`)

```
visualize_data — Turn a set of data points into a visual in the space: a row of cards, a bar chart,
  a timeline, or a single big stat. Use this to SHOW data you have (e.g. a weather forecast you just
  looked up, numbers you know) instead of only saying it. Provide the data as `series`; pick a
  `layout` that fits, or omit it to let a sensible one be chosen. Optionally give a `title`.
  series:    array of { label, value?, secondary?, caption?, color? }
  layout?:   "card_row" | "bar_chart" | "timeline" | "stat"
  title?:    string
  position?: { x, y, z }
```

### 4. Handler — `visualize_data` case (`src/agent/toolHandlers.ts`)

Synchronous. Validate `series` (array, non-empty → else friendly error; cap to `MAX_POINTS` with a
note in the result). Resolve `layout` (arg or `pickLayout`). Compute the anchor (arg `position` or
the existing in-front-of-user default used by other spawns). Call the layout fn → `ObjectSpec[]`.
Mint a `groupId`, spawn each spec with it, `toast` a friendly line. Return
`{ ok, groupId, count, layout, scene: summary() }`. On an unknown `layout` string, fall back to
`pickLayout` (never error on that).

### 5. Agent instructions (`server/realtime.ts`)

Add a short paragraph: the agent can **show** data with `visualize_data` (not just say it) — e.g.
after looking up the weather, render it as a chart; it chooses the layout if the person didn't ask
for one, and can `delete`/replace a chart by its group. Keep it brief (the Skills layer, Spec 4,
generalizes this later).

## Files

| Path | Change |
|---|---|
| `src/scene/visualize.ts` | **New** — pure layout module (4 templates + `pickLayout` + `normalizeHeights` + `ObjectSpec`). Heavily commented. |
| `src/scene/visualize.test.ts` | **New** — unit tests for layout math, heuristic, normalization, point→spec mapping. |
| `src/scene/types.ts` | Add `groupId?: string` to `SceneObject`. |
| `src/scene/store.ts` | `SpawnArgs.groupId`; `removeGroup`, `nextGroupId`; group-aware `summary()`. |
| `src/scene/store.test.ts` | Tests for `removeGroup` / `nextGroupId` / grouped summary, and the `visualize_data` handler (builds N grouped objects; heuristic path; empty-series error). |
| `src/agent/tools.ts` | Add the `visualize_data` schema. |
| `src/agent/toolHandlers.ts` | Add the `visualize_data` handler case. |
| `server/realtime.ts` | Extend `INSTRUCTIONS` with the visualize-data paragraph. |
| `STATUS.md` | Document the tool, grouping, and the visualize module. |

## Testing

- **Unit (vitest):**
  - `pickLayout` — 1 point → `stat`; all-numeric `value` → `bar_chart`; mixed/missing → `card_row`.
  - `normalizeHeights` — maps min→`MIN_BAR`, max→`MAX_BAR`; a flat series → all `MAX_BAR`; handles a
    single value.
  - each layout fn — correct object **count** (e.g. card_row → N panels +1 title), kinds, centered
    spacing (positions symmetric about the anchor x), bar heights via `scale`, text composed from
    label/value/secondary/caption with absent fields omitted.
  - store — `nextGroupId` increments; `removeGroup` deletes exactly the group's members and returns
    the count; `summary()` lists the group.
  - handler — `visualize_data` with a 7-point series spawns 7(+title) objects all sharing one
    `groupId`; omitting `layout` uses the heuristic; empty `series` → `{ ok:false }` with no spawns.
- **Manual (deploy + VM):** desktop Chrome — "what's the weather in Tokyo this week?" then "show me
  that as a chart" → a bar chart appears; "show it as cards instead" → card row; "clear the chart" →
  the group is removed. Check `./scripts/logs.sh` shows the `visualize_data` call. Then the Quest —
  confirm the layout reads well at human scale in immersive mode (tune the constants if needed).

## Error handling

- Empty/with no usable points → `{ ok:false, error }`, nothing spawned, scene summary returned.
- `series` longer than `MAX_POINTS` → truncated, with a note in the result so the agent can mention it.
- Unknown `layout` value → silently fall back to `pickLayout` (don't fail the call).
- Points missing `value` in a numeric template → that bar is treated as 0 height (still labeled).
- All handler results include the scene summary so the agent stays oriented.

## Out of scope (later / other specs)

- **Server-side data handles** (chose inline `series`).
- **New composite "visualization" object kind** (chose `groupId` tagging).
- **Animated/streaming/updating charts**, axes/gridlines/tick labels, legends, 3D surface plots.
- **Auto-visualize** after a fetch (the agent decides to call `visualize_data`; no automatic trigger).
- Admin UI (Spec 3) and Skills (Spec 4).
