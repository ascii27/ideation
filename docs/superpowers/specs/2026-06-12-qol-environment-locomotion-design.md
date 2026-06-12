# Quality-of-life: Environment Controls, Object Transforms, Locomotion & Status HUD

_Design spec — 2026-06-12. Follows Effort A (positioning & physics). Scoped as two PRs._

## Goal

Six quality-of-life improvements requested by the user, grouped into two cohesive,
independently-testable PRs:

**PR-A — Environment & Objects** (agent-driven; store + tools)
1. Change **sky color** by voice.
2. Change **ambient light** intensity by voice (models showing up dark when far/high).
3. **Glow** — objects can be light sources (candle, sun). _(item #5, "optional")_
4. **Transform** — stretch/squish objects (non-uniform scale). _(item #6)_

**PR-B — Locomotion & Status HUD** (XR input + UI)
5. **Movement** — fix intermittent loss of teleport; add thumbstick **hop** + **snap-turn**.
6. **Status bubble** — a floating HUD above the avatar so the user knows when async
   work (texture/model/image generation, text additions) is happening.

Explicitly **out of scope** (future efforts, per the user): on-the-fly **scripted object
movement/animation**, and scene **persistence**. Effort B (external data) remains the next
big effort after this.

---

## PR-A — Environment & Objects

### Store & types

`src/scene/types.ts` — extend `SceneObject`:

```ts
/** Per-axis stretch/squish multipliers on top of `size`. Default [1,1,1]. */
scale?: [number, number, number]
/** Light emission strength. 0 / undefined = no glow. >0 = emissive + point light. */
glow?: number
```

New scene-global environment state (new interface in `types.ts`, lives in the store):

```ts
export interface EnvironmentState {
  /** Background + fog color (CSS string). */
  skyColor: string
  /** Ambient light intensity (0..~3). */
  ambientIntensity: number
  /** Whether distance fog is drawn (fog color follows skyColor). */
  fog: boolean
}
```

`src/scene/store.ts`:
- Add `environment: EnvironmentState` with defaults `{ skyColor: '#0a0a0f', ambientIntensity: 0.4, fog: true }` (current hardcoded values).
- Add `setEnvironment(patch: Partial<EnvironmentState>): EnvironmentState` (mirrors `setPhysics`).
- `spawn`/`update` carry `scale` and `glow` through like the other material fields.
- `summary()` mentions a stretched object (e.g. `stretched`) and a glowing one (e.g. `glowing`)
  so the agent's spatial memory reflects them.

### Tools (`src/agent/tools.ts` + `src/agent/toolHandlers.ts`)

**New `set_environment`:**

```
set_environment — Change the overall environment: the sky/background color, how bright the
ambient light is (raise it if objects look too dark), and whether distance fog is shown.
Set only the field(s) the person asked to change.
  skyColor?: string         CSS color/hex for the sky and fog.
  ambientIntensity?: number Ambient brightness ~0..3. Default 0.4. Raise to ~1 to brighten dark models.
  fog?: boolean             Whether distance haze is drawn.
```

Handler: `scene.setEnvironment(patch)`, return `{ ok, environment, scene: summary() }`.

**Extend `update_object`** with two optional params:

```
scale: [x,y,z] absolute per-axis stretch multipliers (1 = unchanged, 2 = twice as long on
       that axis, 0.5 = squished to half). Combine with size for overall scaling.
glow:  number light emission. 0 = off (default). ~1 = soft like a candle, higher = brighter
       like a lamp or sun. The glow takes the object's color.
```

Handler: thread `scale` and `glow` into the `update` patch (validate `scale` is a 3-number
array; clamp `glow >= 0`).

### Rendering

`src/xr/Scene.tsx` — read `environment` from the store:
- `<color attach="background" args={[environment.skyColor]} />`
- `<fog>` rendered only when `environment.fog`, color = `skyColor` (keep the `6, 22` near/far).
- `<ambientLight intensity={environment.ambientIntensity} />`.
- The existing `directionalLight` / accent `pointLight` stay.

`src/xr/SceneObjects.tsx`:
- **Per-axis scale.** Replace uniform `scale={obj.size}` with effective per-axis
  `[size*sx, size*sy, size*sz]` (helper `effectiveScale(obj)` returning a `[x,y,z]`).
  Applies to `PrimitiveBody` and the model wrapper group.
- **Colliders scale to match** (`PrimitiveCollider` and the model `CuboidCollider` take the
  scale and multiply half-extents per axis; the model collider's y-offset uses the scaled
  half-height). A **non-uniformly-scaled sphere** has no exact Rapier collider (no ellipsoid);
  use a `BallCollider` with the **mean** of the three scaled radii — a documented approximation.
- **Glow.** When `obj.glow > 0`:
  - Material gets `emissive = obj.color`, `emissiveIntensity ≈ glow`, `toneMapped={false}`
    (so it visibly blooms; mirrors the avatar core).
  - Add a color-matched `<pointLight color={obj.color} intensity={f(glow)} distance={…} decay={2} />`
    as a child so it actually illuminates neighbors. A candle lights its surroundings; a sun
    brightens the scene.
  - **Light cap.** Track how many glow point-lights are active (a small selector/counter over
    the store); cap at **6** simultaneous glow point-lights (WebGL dynamic-light budget). Past
    the cap, additional glowing objects render emissive-only (still visibly glow, just cast no
    light). Log via `/api/log` when the cap is hit so it's visible in `scripts/logs.sh`.

### Tests (`src/scene/store.test.ts`)
- `setEnvironment` merges partial patches; defaults are the prior hardcoded values.
- `update_object` with `scale` / `glow` persists them; `summary()` reflects stretched/glowing.
- A geometry helper test for scaled collider half-extents (incl. the sphere-mean rule).

---

## PR-B — Locomotion & Status HUD

### Movement-loss fix (the intermittent bug)

**Root cause (from code review):** teleport raycasts the base floor `TeleportTarget`
(`Scene.tsx`, plane at y=0). `create_ground` spawns a **new** plane at y=0.02 (`GroundBody`)
that is **not** a teleport target and sits just above the floor — so after ground is laid
down, the teleport ray hits the ground plane and teleport silently stops working. This matches
"a few times" (only after a ground surface exists).

**Fix:** make `GroundBody`'s mesh a `TeleportTarget` as well, wired to the same `onTeleport`
handler. Thread `onTeleport` down to `SceneObjects` → `GroundBody` (prop, or a tiny context).
The thumbstick hop below is also raycast-independent, so locomotion no longer depends on a
single occludable target.

### Thumbstick locomotion

New `src/xr/Locomotion.tsx`, rendered inside `<XR>` (in `App.tsx`). Reads the left/right
controller thumbstick axes each frame via `@react-three/xr` controller state. Teleport-by-
pointing is unchanged.

- **Left stick → hop.** When stick magnitude > **0.7** and not already armed, move the player
  ~**1.5 m** in the pushed direction, taken **relative to current facing** (stick vector
  rotated by the player's view yaw). Debounced: fires once per push; re-arms when the stick
  recenters (< **0.3**). Updates `playerPos`.
- **Right stick L/R → snap-turn.** When `|x| > 0.7` and not armed, rotate the view **45°**
  (sign from stick direction), **pivoting around the head** so the player rotates in place
  without translating. Same debounce/re-arm. Updates a `playerYaw`.

`App.tsx` lifts state up: `playerPos` (exists) **and** new `playerYaw`. The `XROrigin` gets
`position={playerPos}` and `rotation={[0, playerYaw, 0]}`; snap-turn computes the position
adjustment so the rotation pivots about the camera's world XZ, not the origin. Setters are
passed to `Locomotion` and (for `playerPos`) to teleport as today.

Constants centralized at the top of `Locomotion.tsx`: `HOP_DISTANCE = 1.5`,
`SNAP_TURN_RADIANS = Math.PI/4`, `STICK_ON = 0.7`, `STICK_OFF = 0.3`.

### Status HUD bubble

**Store** (`src/scene/store.ts`) — a transient activity list:

```ts
interface Activity { id: string; text: string; status: 'active' | 'done' | 'error' }
activities: Activity[]
beginActivity(text: string): string          // returns id; status 'active'
endActivity(id: string, text?: string, status?: 'done' | 'error'): void
toast(text: string): string                  // one-off 'done' line for quick actions
```

The list is small; the **HUD component owns expiry** (removes `done`/`error`/toast lines a
couple seconds after they settle; `active` lines persist until ended). Expiry uses
`setTimeout` in the component (browser), not the store.

**Rendering** — new `src/xr/StatusBubble.tsx`, rendered **inside the `AgentAvatar` group**,
positioned just **above** the glass sphere (e.g. `position={[0, RADIUS*2.2, 0]}`), so it
follows the user with the avatar and faces them. Renders each active/recent `Activity` as a
small `<Text>` line on a faint rounded panel (reuse the text-panel look). Hidden when empty.
A spinner-ish affordance for `active` lines (e.g. a pulsing dot or trailing "…").

**Emitters** — `handleToolCall` wraps the async tools:
- `create_image_panel`: `beginActivity('generating image…')` → `endActivity(id, 'image ready')`
  / `'image failed'`.
- `spawn_model`: `beginActivity('finding model…')` → end on success/failure.
- `apply_texture`: `beginActivity('applying texture…')` → end.
- `create_ground`: `beginActivity('generating ground texture…')` → end (this was the original
  10–20 s no-feedback case).
- Quick/synchronous actions emit a short `toast(...)`: e.g. `'added a note'`
  (`create_text_panel`), `'changed the sky'` (`set_environment`), `'added a {color} {kind}'`
  (`spawn_object`). Keep them terse.

So the user always sees *something* happening, including text additions (item #2's ask).

### Tests
- Store: `beginActivity`/`endActivity`/`toast` transitions; `activities` reflects state.
- A small pure helper for snap-turn pivot math (rotating a point about a center on XZ) is
  unit-tested in `geometry.test.ts`.

---

## Rollout

- **PR-A** branch `qol-environment-objects` off `main`. **PR-B** branch `qol-locomotion-status`
  off `main` (or stacked on A if A isn't merged yet — per repo convention).
- Each: `npm run typecheck && npm test && npm run build`, then `./scripts/deploy.sh`, verify at
  https://armchair-sparkle.exe.xyz/ — desktop Chrome first (sky/light/glow/transform, HUD
  toasts), then the Quest (thumbstick hop + snap-turn, teleport-after-ground, HUD in VR). Watch
  `./scripts/logs.sh` for tool calls and the glow-cap log line.
- Update `STATUS.md` after each merge.

## Open approximations (accepted)
- Non-uniformly-scaled **sphere** collider uses the mean scaled radius (no ellipsoid in Rapier).
- Glow point-lights capped at **6**; excess glowing objects are emissive-only.
- Snap-turn / hop tuning values are constants, easy to adjust after in-headset feel-testing.
