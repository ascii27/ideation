# Effort A — Positioning, Ground & Physics

_Design spec. Date: 2026-06-12. Status: approved for planning._

## Context

Ideation is a voice-driven WebXR brainstorming space (see `STATUS.md`). The agent
manipulates a 3D scene via tools against a zustand store; React Three Fiber renders
from the store. Three positioning/orientation problems and a missing physics layer
need fixing before the next capability work (external data integrations, Effort B —
out of scope for this spec).

### Problems being fixed

1. **Agent avatar is static.** It is pinned to a fixed world position `[0, 1.4, -1.6]`
   in `src/xr/AgentAvatar.tsx` and does not track the user.
2. **Spawned objects look buried.** Default spawn places objects at `y = 1.3`
   (`src/scene/store.ts`), and models are recentered on their bounding-box center
   (`src/xr/SceneObjects.tsx`). When the agent places something "on the floor" at
   `y = 0`, half of it sinks below ground.
3. **No solid ground / vertical reference.** The grid (`src/xr/Scene.tsx`) sits at
   `y ≈ 0` and there is an invisible teleport plane, but nothing enforces "0 = solid
   ground," and there is no physics floor. The user reports feeling half-sunk into
   the ground.
4. **No physics at all** — no engine, no colliders, no gravity.

## Goals

- The grid plane is the canonical **ground at y = 0** (solid, physical floor).
- Solid objects (primitives + models) **rest on the ground** instead of floating or
  burying.
- **Physics (gravity) and collision detection are ON by default.**
- The user can **toggle physics and collision on/off by voice** (agent tool).
- The agent avatar **follows the user**, hovering at the **lower-right** of their view,
  **~40% smaller** than today.

## Non-goals

- External data source integrations (weather, data-as-objects) — Effort B, separate spec.
- Snap-turn locomotion (still out, per STATUS.md).
- Texturing/tinting loaded GLB models.
- Persistence across reloads (Phase 4).

## Design

### 1. Solid ground at y = 0

- Add **`@react-three/rapier`** as the physics layer. It is the standard R3F physics
  engine and integrates with the existing `@react-three/handle` grab system.
- Wrap the scene contents in `<Physics>` with gravity `[0, -9.81, 0]`.
- Add a **fixed (static) ground collider at y = 0**, coplanar with the existing grid
  and the existing invisible teleport plane. The grid becomes the literal, physical
  floor. The teleport plane stays (teleport raycasting is unchanged).
- Player rig feet remain at `y = 0`: `XROrigin` stays at the teleport point (y=0);
  headset head-height is left to the device. No change to teleport logic.
- **Diagnostic note:** the "halfway-in-the-ground" feeling is expected to resolve once
  there is a real floor reference and objects rest on it. If it persists specifically
  in-headset after this change, that is a separate device-calibration investigation to
  do live on the Quest; it is not addressed by code in this spec.

### 2. Objects rest on the ground (no more burying)

- Every **solid** object (primitives: box/sphere/cylinder/cone/torus; and models) is
  wrapped in a rigid body.
- **Base-on-floor offset:** instead of centering geometry on the group origin, solids
  are offset vertically so their **lowest point sits at the body's y-position**. For
  primitives this is a known half-height per shape × size. For models, reuse the
  existing bounding-box normalization (`NormalizedModel`) but offset by `+halfHeight`
  after scaling so the model's base — not its center — is at the origin.
- **Default spawn position:** place new solids a comfortable distance in front of the
  user **resting on the ground** (body y such that the base is at y = 0), replacing the
  current floating `y = 1.3`. With gravity on they settle immediately; no half-buried
  geometry. The loose-arc x/z placement from `defaultPosition` is retained; only the
  default height changes.
- **Colliders:** auto-generated from geometry — exact analytic shapes for primitives
  (cuboid/ball/etc. via rapier collider props), convex hull for models.

### 3. Physics + collision, on by default, agent-toggleable

- **Gravity ON and collision ON by default.**
- **Solids only** participate in physics (user decision). Text and image panels render
  **outside** the physics bodies and keep their placed position — they are floating UI,
  not physical objects. Their default placement height is unchanged (they may still be
  placed in the air).
- **Grab & release (drop & settle):** while an object is grabbed via
  `@react-three/handle`, its rigid body is driven **kinematically** (position/rotation
  follow the hand). On release the body switches back to **dynamic** and falls/settles
  under gravity, colliding with the ground and other solids. After it settles, the
  resting transform is **synced back to the zustand store** (as the current grab code
  already does on release) so the agent's spatial memory, summary, and credits stay
  correct.
- **New agent tool `set_physics`:**
  - Parameters (both optional): `gravity` (boolean), `collision` (boolean).
  - `gravity: false` → freeze solids in place (they hang where they are; achieved by
    pausing simulation or zeroing gravity so nothing falls). `gravity: true` → resume
    falling/settling.
  - `collision: false` → solids no longer collide with each other or the ground (pass
    through). `collision: true` → restore collision.
  - State lives in the scene store (e.g. `physics: { gravity: boolean; collision:
    boolean }`) so the renderer reacts and tests can assert transitions.
  - The handler returns the usual scene summary plus the new physics state.
- **Agent instructions:** add a sentence to `server/realtime.ts` describing that
  physics/gravity and collision are on by default and can be toggled with `set_physics`
  (e.g. "turn off gravity," "disable collisions," "turn physics back on").
- **Tool schema:** add `set_physics` to `src/agent/tools.ts` (shared with the server
  session config).

### 4. Agent ball follows the user (lower-right, ~40% smaller)

- The avatar moves out of fixed world space into a **lazy body-follow** rig:
  - Each frame, compute a **target point** at a fixed offset relative to the user's head
    (camera): down and to the right, slightly in front, so it sits in the lower-right of
    the field of view at a comfortable distance.
  - `damp`/lerp the avatar's position (and facing) toward that target so it **glides and
    catches up** when the user walks or turns, without tracking every small head twitch.
    Tunable smoothing constant.
- **~40% smaller:** `RADIUS 0.22 → ~0.13`. The attached `SettingsPanel` is repositioned/
  scaled to match so it remains readable and clickable.
- The avatar stays **outside physics** (a companion, not a falling object).
- Its existing state-color / speaking-pulse / click-to-open-settings behavior is
  preserved.

## Affected files

| File | Change |
|---|---|
| `package.json` | add `@react-three/rapier` |
| `src/xr/Scene.tsx` | wrap contents in `<Physics>`; add ground collider at y=0; pass physics state |
| `src/xr/SceneObjects.tsx` | wrap solids in `RigidBody`; base-on-floor offset; kinematic-while-grabbed; sync on settle |
| `src/scene/store.ts` | `physics` state + `setPhysics`; default spawn height = base on floor |
| `src/scene/types.ts` | physics state types if needed |
| `src/xr/AgentAvatar.tsx` | lazy body-follow rig; smaller radius; panel rescale |
| `src/agent/tools.ts` | add `set_physics` tool schema |
| `src/agent/toolHandlers.ts` | handle `set_physics` |
| `server/realtime.ts` | mention physics toggling in agent instructions |
| `src/scene/store.test.ts` | new tests (below) |

## Testing

Unit tests (vitest, no headset — consistent with the existing test suite):

- **Base-on-floor math:** for a given primitive kind + size, the computed vertical
  offset puts the base at y = 0; for a model bounding box, base-on-floor offset is correct.
- **Default spawn height:** newly spawned solids default to resting-on-ground height, not
  the old floating `y = 1.3`.
- **`set_physics` transitions:** store reflects `gravity`/`collision` flips; handler
  returns updated state + scene summary; partial updates (only one flag) leave the other
  unchanged.

On-device (manual, at https://armchair-sparkle.exe.xyz/ via the deploy-and-test loop):

- Avatar follows to lower-right and glides on movement/turn; is ~40% smaller; settings
  still open on click.
- Spawned table + chairs rest on the floor (not buried); objects fall and settle; grab
  and drop settles; "turn off gravity / collisions" and "turn physics back on" behave.

## Trade-offs / accepted costs

- With gravity on by default, "make a floating box" will fall unless the user also turns
  gravity off. Accepted — physics-on-by-default was the explicit request; floating
  **panels** (text/image) are exempt so notes still hover.
- Physics adds a dependency and per-frame cost. Acceptable for the object counts in a
  brainstorming scene.
- The store is the source of truth for agent memory, but rigid bodies own live
  transforms; we reconcile by writing settled transforms back to the store on release
  (as today). Continuous high-frequency sync is not needed for agent memory.
