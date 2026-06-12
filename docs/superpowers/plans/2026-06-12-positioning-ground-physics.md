# Positioning, Ground & Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grid a solid ground at y=0, give solid objects gravity + collision (on by default, voice-toggleable) so they rest instead of burying, and make the agent avatar follow the user at the lower-right of their view, ~40% smaller.

**Architecture:** Add `@react-three/rapier` as a physics layer wrapping the scene. Solid objects (primitives + models) become `RigidBody`s that rest on a fixed ground collider at y=0; text/image panels stay outside physics as floating UI. Physics state (gravity/collision) lives in the zustand store and is toggled by a new `set_physics` agent tool. The avatar moves each frame toward a head-relative lower-right target with damping.

**Tech Stack:** React 18 + TypeScript, React Three Fiber v8, `@react-three/rapier` v1 (Rapier physics), `@react-three/handle` (grab), `@react-three/xr`, zustand, three 0.171, vitest.

---

## Spec

Implements `docs/superpowers/specs/2026-06-12-positioning-ground-physics-design.md`.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `package.json` | add `@react-three/rapier@^1.5.0` | Modify |
| `src/scene/geometry.ts` | pure `solidHalfHeight(kind,size)` + physics group constants | Create |
| `src/scene/geometry.test.ts` | tests for the geometry helper | Create |
| `src/scene/types.ts` | `PhysicsState` type | Modify |
| `src/scene/store.ts` | `physics` state, `setPhysics`, base-on-floor default spawn height | Modify |
| `src/agent/tools.ts` | `set_physics` tool schema | Modify |
| `src/agent/toolHandlers.ts` | handle `set_physics` | Modify |
| `src/scene/store.test.ts` | tests for default spawn height + `set_physics` | Modify |
| `server/realtime.ts` | mention physics toggling in agent instructions | Modify |
| `src/xr/Scene.tsx` | `<Physics>` wrapper + ground collider, wire physics state | Modify |
| `src/xr/SceneObjects.tsx` | solids as `RigidBody`, base offset, grab-kinematic, settle-sync, agent-move sync | Modify |
| `src/xr/AgentAvatar.tsx` | lazy body-follow rig, ~40% smaller | Modify |

## Testing strategy

- **Pure logic** (`geometry.ts`, `store.ts` physics state + spawn height, `toolHandlers.ts` `set_physics`): full TDD with vitest, consistent with `src/scene/store.test.ts`.
- **Renderer / physics / avatar** (`Scene.tsx`, `SceneObjects.tsx`, `AgentAvatar.tsx`): no DOM/WebGL unit tests exist in this repo; verify with `npm run typecheck`, `npm run build`, then the deploy-and-test loop at https://armchair-sparkle.exe.xyz/ (desktop Chrome first, then Quest). Each such task lists explicit manual acceptance checks.

---

## Task 1: Add the Rapier physics dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pinned to v1 (R3F v8 compatibility)**

Run:
```bash
npm install @react-three/rapier@^1.5.0
```
Expected: `package.json` dependencies gain `"@react-three/rapier": "^1.5.0"`; `package-lock.json` updates; no peer-dependency errors against `@react-three/fiber@^8`.

- [ ] **Step 2: Verify the toolchain still builds**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck passes, existing 18 tests pass, build succeeds (large-chunk warnings are expected).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @react-three/rapier (v1, R3F v8 compatible)"
```

---

## Task 2: Geometry helper — base-on-floor math + physics groups

A pure module so the resting height is testable and shared between the store (default spawn height) and the renderer (collider sizing).

**Files:**
- Create: `src/scene/geometry.ts`
- Test: `src/scene/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scene/geometry.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { solidHalfHeight, isSolidKind, OBJECT_GROUPS, OBJECT_GROUPS_NO_COLLIDE, FLOOR_GROUPS } from './geometry'

describe('solidHalfHeight', () => {
  it('returns the y half-extent so the base sits at the floor', () => {
    expect(solidHalfHeight('box', 0.5)).toBeCloseTo(0.25)
    expect(solidHalfHeight('sphere', 0.5)).toBeCloseTo(0.3)
    expect(solidHalfHeight('cylinder', 1)).toBeCloseTo(0.5)
    expect(solidHalfHeight('cone', 1)).toBeCloseTo(0.5)
    expect(solidHalfHeight('torus', 1)).toBeCloseTo(0.7)
  })

  it('scales linearly with size', () => {
    expect(solidHalfHeight('box', 2)).toBeCloseTo(1)
  })

  it('treats panels and models as zero (handled elsewhere)', () => {
    expect(solidHalfHeight('text', 1)).toBe(0)
    expect(solidHalfHeight('image', 1)).toBe(0)
    expect(solidHalfHeight('model', 1)).toBe(0)
  })
})

describe('isSolidKind', () => {
  it('is true for primitives and models, false for panels', () => {
    expect(isSolidKind('box')).toBe(true)
    expect(isSolidKind('model')).toBe(true)
    expect(isSolidKind('text')).toBe(false)
    expect(isSolidKind('image')).toBe(false)
  })
})

describe('interaction groups', () => {
  it('exposes distinct collide / no-collide bitmasks for objects', () => {
    expect(typeof OBJECT_GROUPS).toBe('number')
    expect(typeof OBJECT_GROUPS_NO_COLLIDE).toBe('number')
    expect(typeof FLOOR_GROUPS).toBe('number')
    expect(OBJECT_GROUPS).not.toBe(OBJECT_GROUPS_NO_COLLIDE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/geometry.test.ts`
Expected: FAIL — `Cannot find module './geometry'`.

- [ ] **Step 3: Write the implementation**

Create `src/scene/geometry.ts`:
```typescript
// Pure geometry + physics-group helpers shared by the store (default resting
// height) and the renderer (collider sizing, collision toggling). No three/rapier
// imports so it stays unit-testable.

import type { ObjectKind } from './types'
import { interactionGroups } from '@react-three/rapier'

// Physics collision groups (rapier supports 16 groups, indices 0..15).
const GROUP_FLOOR = 0
const GROUP_OBJECT = 1

// Floor collides with objects only.
export const FLOOR_GROUPS = interactionGroups([GROUP_FLOOR], [GROUP_OBJECT])
// Objects collide with the floor AND each other (collision ON).
export const OBJECT_GROUPS = interactionGroups([GROUP_OBJECT], [GROUP_FLOOR, GROUP_OBJECT])
// Objects collide with the floor only — pass through each other (collision OFF).
export const OBJECT_GROUPS_NO_COLLIDE = interactionGroups([GROUP_OBJECT], [GROUP_FLOOR])

// Half-height (in y) of a primitive's unit geometry, scaled by `size`. Placing a
// body at y = solidHalfHeight puts its base on the floor (y = 0). Mirrors the
// geometry dimensions in SceneObjects.tsx (sphere r=0.6, cylinder/cone h=1,
// torus outer=0.7, box=1) all scaled by the mesh `scale={size}`. Panels and
// models return 0 (panels float; models are offset by their bounding box in the
// renderer).
export function solidHalfHeight(kind: ObjectKind, size: number): number {
  switch (kind) {
    case 'sphere':
      return 0.6 * size
    case 'torus':
      return 0.7 * size
    case 'box':
    case 'cylinder':
    case 'cone':
      return 0.5 * size
    default:
      return 0
  }
}

// Solids participate in physics (gravity + collision). Panels do not.
export function isSolidKind(kind: ObjectKind): boolean {
  return kind !== 'text' && kind !== 'image'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scene/geometry.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/scene/geometry.ts src/scene/geometry.test.ts
git commit -m "feat: base-on-floor geometry helper + physics group masks"
```

---

## Task 3: Physics state in the store + base-on-floor default spawn

Adds `physics: { gravity, collision }` with a `setPhysics` action, and changes the default spawn height so solids rest on the floor instead of floating at y=1.3.

**Files:**
- Modify: `src/scene/types.ts`
- Modify: `src/scene/store.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/scene/store.test.ts` (inside the file, after the existing `describe('scene store', ...)` block — add a new describe):
```typescript
describe('physics state + resting spawn', () => {
  it('defaults to gravity and collision on', () => {
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: true })
  })

  it('setPhysics flips flags independently, leaving the other unchanged', () => {
    useScene.getState().setPhysics({ gravity: false })
    expect(useScene.getState().physics).toEqual({ gravity: false, collision: true })
    useScene.getState().setPhysics({ collision: false })
    expect(useScene.getState().physics).toEqual({ gravity: false, collision: false })
    useScene.getState().setPhysics({ gravity: true })
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: false })
  })

  it('spawns a primitive resting on the floor (base at y=0)', () => {
    const box = useScene.getState().spawn({ kind: 'box', size: 0.5 })
    // box half-height = 0.25 → body y = 0.25 so the base touches the floor
    expect(box.position[1]).toBeCloseTo(0.25)
  })

  it('spawns a model with its base at the floor (y=0)', () => {
    const m = useScene.getState().spawn({ kind: 'model', size: 0.7 })
    expect(m.position[1]).toBeCloseTo(0)
  })

  it('keeps panels floating (unchanged default height)', () => {
    const t = useScene.getState().spawn({ kind: 'text', text: 'hi' })
    expect(t.position[1]).toBeCloseTo(1.3)
  })

  it('honors an explicit position for solids', () => {
    const box = useScene.getState().spawn({ kind: 'box', position: { x: 0, y: 2, z: -1 } })
    expect(box.position).toEqual([0, 2, -1])
  })
})
```

Also reset physics between tests — update the top-level `beforeEach` in `src/scene/store.test.ts`:
```typescript
beforeEach(() => {
  useScene.getState().clear()
  useScene.getState().setPhysics({ gravity: true, collision: true })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/scene/store.test.ts`
Expected: FAIL — `physics`/`setPhysics` undefined; resting-height assertions fail (current default y is 1.3).

- [ ] **Step 3: Add the PhysicsState type**

In `src/scene/types.ts`, add at the end of the file:
```typescript
/** Global physics toggles, controlled by the agent's set_physics tool. */
export interface PhysicsState {
  /** When false, solids float in place (no gravity). */
  gravity: boolean
  /** When false, solids pass through each other (they still rest on the floor). */
  collision: boolean
}
```

- [ ] **Step 4: Wire physics state + resting height into the store**

In `src/scene/store.ts`:

(a) Update imports at the top:
```typescript
import { create } from 'zustand'
import type { Attribution, ObjectKind, PhysicsState, SceneObject } from './types'
import type { MaterialPreset } from './materials'
import { isSolidKind, solidHalfHeight } from './geometry'
```

(b) Add to the `SceneState` interface (after `credits: () => string[]`):
```typescript
  /** Global physics toggles (gravity + collision). */
  physics: PhysicsState
  /** Update one or both physics flags; omitted flags are left unchanged. */
  setPhysics: (patch: Partial<PhysicsState>) => PhysicsState
```

(c) Replace the `defaultPosition` helper so it computes a resting y per kind/size:
```typescript
// When no explicit position is given, place new objects in a loose arc in front
// of the user (who stands near the origin looking toward -z). Solids rest on the
// floor (base at y=0); panels float at eye-ish height.
function defaultPosition(index: number, kind: ObjectKind, size: number): [number, number, number] {
  const angle = -0.6 + 0.35 * index
  const radius = 2.2
  const x = round(Math.sin(angle) * radius)
  const z = round(-Math.cos(angle) * radius)
  const y = isSolidKind(kind) ? round(solidHalfHeight(kind, size)) : 1.3
  return [x, y, z]
}
```

(d) In the `spawn` action, the `size` must be resolved before computing the position. Replace the object construction so `size` is computed first and passed to `defaultPosition`:
```typescript
  spawn: (args) => {
    const { counters, objects } = get()
    const n = (counters[args.kind] ?? 0) + 1
    const size =
      args.size ??
      (args.kind === 'text' ? 1 : args.kind === 'image' ? 1.5 : args.kind === 'model' ? 0.7 : 0.5)
    const obj: SceneObject = {
      id: `${args.kind}-${n}`,
      kind: args.kind,
      position: args.position
        ? [args.position.x, args.position.y, args.position.z]
        : defaultPosition(objects.length, args.kind, size),
      size,
      rotation: args.rotation,
      color: args.color ?? '#99aadd',
      label: args.label,
      text: args.text,
      src: args.src,
      attribution: args.attribution,
      textureSrc: args.textureSrc,
      textureRepeat: args.textureRepeat,
      materialPreset: args.materialPreset,
      metalness: args.metalness,
      roughness: args.roughness,
    }
    set({ objects: [...objects, obj], counters: { ...counters, [args.kind]: n } })
    return obj
  },
```

(e) Add the physics state + action to the store object. Add an initial value near `objects: [], counters: {},`:
```typescript
  physics: { gravity: true, collision: true },
```
and add the action (place it after `clear`):
```typescript
  setPhysics: (patch) => {
    const next: PhysicsState = { ...get().physics, ...patch }
    set({ physics: next })
    return next
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/scene/store.test.ts`
Expected: PASS, including the existing tests (the `move`/`position` tests use explicit values and are unaffected).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/scene/types.ts src/scene/store.ts src/scene/store.test.ts
git commit -m "feat: physics state in store + base-on-floor default spawn height"
```

---

## Task 4: `set_physics` agent tool (schema + handler + instructions)

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `src/agent/toolHandlers.ts`
- Modify: `server/realtime.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/scene/store.test.ts`:
```typescript
describe('set_physics tool', () => {
  it('toggles gravity and reports the new physics state + scene', async () => {
    const r = (await handleToolCall('set_physics', { gravity: false })) as {
      ok: boolean
      physics: { gravity: boolean; collision: boolean }
      scene: string
    }
    expect(r.ok).toBe(true)
    expect(r.physics).toEqual({ gravity: false, collision: true })
    expect(typeof r.scene).toBe('string')
    expect(useScene.getState().physics.gravity).toBe(false)
  })

  it('toggles collision independently', async () => {
    await handleToolCall('set_physics', { collision: false })
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: false })
  })

  it('with no args is a no-op that still reports state', async () => {
    const r = (await handleToolCall('set_physics', {})) as { ok: boolean; physics: unknown }
    expect(r.ok).toBe(true)
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/scene/store.test.ts`
Expected: FAIL — `set_physics` is an unknown tool (`ok: false`).

- [ ] **Step 3: Add the tool schema**

In `src/agent/tools.ts`, add this object to the `TOOL_DEFINITIONS` array (place it just before `list_scene`):
```typescript
  {
    type: 'function',
    name: 'set_physics',
    description:
      'Turn physics on or off in the space. gravity controls whether solid objects fall and settle (off = they float frozen in place). collision controls whether solids bump into each other (off = they pass through; they still rest on the floor). Both are on by default. Set only the flag(s) the person asked to change.',
    parameters: {
      type: 'object',
      properties: {
        gravity: { type: 'boolean', description: 'Whether objects fall under gravity.' },
        collision: { type: 'boolean', description: 'Whether objects collide with each other.' },
      },
    },
  },
```

- [ ] **Step 4: Add the handler**

In `src/agent/toolHandlers.ts`, add a case to the switch (place it before `case 'list_scene':`):
```typescript
    case 'set_physics': {
      const patch: { gravity?: boolean; collision?: boolean } = {}
      if (typeof args.gravity === 'boolean') patch.gravity = args.gravity
      if (typeof args.collision === 'boolean') patch.collision = args.collision
      const physics = scene.setPhysics(patch)
      return { ok: true, physics, scene: useScene.getState().summary() }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Mention the tool in the agent instructions**

In `server/realtime.ts`, in the `INSTRUCTIONS` template, append this sentence to the second paragraph (after the `set_material` sentence ending "...make objects feel real."):
```
 Physics is on by default — solid objects fall and rest on the ground and collide with each
 other; floating text/image panels are unaffected. If the person asks, use set_physics to turn
 gravity or collision on or off (e.g. "turn off gravity", "disable collisions", "turn physics back on").
```

- [ ] **Step 7: Typecheck and full test run**

Run: `npm run typecheck && npm test`
Expected: typecheck passes; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/agent/tools.ts src/agent/toolHandlers.ts server/realtime.ts src/scene/store.test.ts
git commit -m "feat: set_physics agent tool to toggle gravity + collision"
```

---

## Task 5: Wrap the scene in Physics + add the ground collider

Renderer task — verified by typecheck/build + device test (no unit test).

**Files:**
- Modify: `src/xr/Scene.tsx`

- [ ] **Step 1: Add the Physics wrapper and ground collider**

Edit `src/xr/Scene.tsx`. Update imports:
```typescript
import { Grid } from '@react-three/drei'
import { TeleportTarget } from '@react-three/xr'
import { Physics, CuboidCollider } from '@react-three/rapier'
import type { Vector3 } from 'three'
import type { RealtimeStatus } from '../agent/realtime'
import { useScene } from '../scene/store'
import { FLOOR_GROUPS } from '../scene/geometry'
import { AgentAvatar } from './AgentAvatar'
import { SceneObjects } from './SceneObjects'
import { CreditsPanel } from './CreditsPanel'
```

Inside the component body, read the gravity flag:
```typescript
  const gravity = useScene((s) => s.physics.gravity)
```

Wrap `SceneObjects` (the only physics participants) plus a ground collider in `<Physics>`. The lights, grid, teleport plane, credits, and avatar stay **outside** physics. Replace the `<SceneObjects />` line with:
```tsx
      {/* Physics world. Gravity toggles via the agent's set_physics tool; when off
          the gravity vector is zeroed so solids hover in place. Only SceneObjects'
          solids are rigid bodies; the floor is a fixed collider coplanar with the grid. */}
      <Physics gravity={gravity ? [0, -9.81, 0] : [0, 0, 0]}>
        {/* Solid ground at y=0 — a thin fixed slab just below the floor plane so
            object bases rest exactly at y=0. */}
        <CuboidCollider type="fixed" args={[40, 0.1, 40]} position={[0, -0.1, 0]} collisionGroups={FLOOR_GROUPS} />
        <SceneObjects />
      </Physics>
```

(The collider is 0.1m thick centered at y=-0.1, so its top surface is exactly y=0.)

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed (chunk-size warnings expected).

- [ ] **Step 3: Commit**

```bash
git add src/xr/Scene.tsx
git commit -m "feat: physics world + solid ground collider at y=0"
```

> Note: the app will not render solids correctly until Task 6 wraps them in RigidBodies. Device testing happens after Task 6.

---

## Task 6: Solids as rigid bodies — base offset, grab-kinematic, settle/agent sync

The core renderer task. Each solid (primitive/model) becomes a `RigidBody`. While grabbed it is driven kinematically by the existing `@react-three/handle`; on release it returns to dynamic and its resting transform is written back to the store. Panels keep the existing non-physics `GrabbableObject`.

**Files:**
- Modify: `src/xr/SceneObjects.tsx`

- [ ] **Step 1: Update imports and add physics-aware grab wrapper**

Edit `src/xr/SceneObjects.tsx`. Update the imports block:
```typescript
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, useGLTF } from '@react-three/drei'
import { Handle, type HandleState } from '@react-three/handle'
import { RigidBody, type RapierRigidBody, RigidBodyType } from '@react-three/rapier'
import {
  Box3,
  DoubleSide,
  type Group,
  type Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { useScene } from '../scene/store'
import { presetToMaterial } from '../scene/materials'
import { isSolidKind, OBJECT_GROUPS, OBJECT_GROUPS_NO_COLLIDE } from '../scene/geometry'
import type { ObjectKind, SceneObject } from '../scene/types'
```

- [ ] **Step 2: Route solids to a physics wrapper, panels to the existing one**

Replace `ObjectView` so solids use a new `PhysicsObject` wrapper and panels keep `GrabbableObject`:
```typescript
function ObjectView({ obj }: { obj: SceneObject }) {
  let body: ReactNode
  if (obj.kind === 'text') body = <TextBody obj={obj} />
  else if (obj.kind === 'image') body = <ImageBody obj={obj} />
  else if (obj.kind === 'model') body = <ModelBody obj={obj} />
  else body = <PrimitiveBody obj={obj} />

  if (isSolidKind(obj.kind)) {
    return <PhysicsObject obj={obj}>{body}</PhysicsObject>
  }
  return <GrabbableObject obj={obj}>{body}</GrabbableObject>
}
```

- [ ] **Step 3: Implement `PhysicsObject`**

Add this component (place it right after `GrabbableObject`):
```typescript
// A solid object as a Rapier rigid body that rests on the floor and collides.
// Grabbing drives it kinematically via @react-three/handle; on release it returns
// to dynamic and its resting transform is written back to the store (agent memory).
// Collision toggling swaps the collider interaction groups; gravity toggling is
// handled globally by the <Physics> gravity prop in Scene.tsx.
function PhysicsObject({ obj, children }: { obj: SceneObject; children: ReactNode }) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const handleRef = useRef<Group>(null)
  const collision = useScene((s) => s.physics.collision)
  const gravity = useScene((s) => s.physics.gravity)

  // Models auto-fit a convex hull; primitives use exact analytic colliders.
  const colliders = obj.kind === 'model' ? 'hull' : 'cuboid'

  // When the agent moves/repositions the object (store position changes outside of
  // a grab), teleport the rigid body to match and clear its velocity.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.setTranslation({ x: obj.position[0], y: obj.position[1], z: obj.position[2] }, true)
    const r = obj.rotation ?? [0, 0, 0]
    const q = new Quaternion().setFromEuler(eulerFrom(r))
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }, [obj.position, obj.rotation])

  const apply = useCallback(
    (state: HandleState<unknown>) => {
      const body = bodyRef.current
      if (!body) return
      if (state.first) {
        // Begin grab: drive kinematically so physics doesn't fight the hand.
        body.setBodyType(RigidBodyType.KinematicPositionBased, true)
      }
      const p = state.current.position
      const q = state.current.quaternion
      body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z })
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      if (state.last) {
        // Release: back to dynamic so it falls/settles (or stays put if gravity off).
        body.setBodyType(RigidBodyType.Dynamic, true)
        if (!gravity) {
          body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        }
        const t = body.translation()
        const rot = body.rotation()
        const e = eulerToArray(new Quaternion(rot.x, rot.y, rot.z, rot.w))
        useScene.getState().update(obj.id, {
          position: { x: round(t.x), y: round(t.y), z: round(t.z) },
          rotation: e,
        })
      }
    },
    [obj.id, gravity],
  )

  return (
    <RigidBody
      ref={bodyRef}
      colliders={colliders}
      collisionGroups={collision ? OBJECT_GROUPS : OBJECT_GROUPS_NO_COLLIDE}
      position={obj.position}
      rotation={obj.rotation ?? [0, 0, 0]}
      canSleep
    >
      <group ref={handleRef}>
        <Handle targetRef={handleRef} scale={false} multitouch={false} apply={apply}>
          {children}
        </Handle>
      </group>
    </RigidBody>
  )
}

// three's Euler import is avoided at module top to keep the diff small; build it here.
function eulerFrom(r: [number, number, number]) {
  // Lazy import-free Euler via Quaternion needs an Euler; use three's Euler.
  return new (require('three').Euler)(r[0], r[1], r[2])
}

function eulerToArray(q: Quaternion): [number, number, number] {
  const e = new (require('three').Euler)().setFromQuaternion(q)
  return [round(e.x), round(e.y), round(e.z)]
}
```

> **Important:** this project is ESM (`"type": "module"`) and bundled by Vite — `require` is **not** available. Replace the two helpers above with a top-level `Euler` import instead. Update the three import block from Step 1 to add `Euler`:
> ```typescript
> import {
>   Box3,
>   DoubleSide,
>   Euler,
>   type Group,
>   type Object3D,
>   Quaternion,
>   RepeatWrapping,
>   SRGBColorSpace,
>   type Texture,
>   TextureLoader,
>   Vector3,
> } from 'three'
> ```
> and replace the two helper functions with:
> ```typescript
> function eulerFrom(r: [number, number, number]): Euler {
>   return new Euler(r[0], r[1], r[2])
> }
>
> function eulerToArray(q: Quaternion): [number, number, number] {
>   const e = new Euler().setFromQuaternion(q)
>   return [round(e.x), round(e.y), round(e.z)]
> }
> ```

- [ ] **Step 4: Offset models so their base (not center) sits at the body origin**

Replace `NormalizedModel` so the model's lowest point is at y=0 of the body:
```typescript
// Raw GLBs vary wildly in scale and pivot, so recenter on the bounding box in x/z,
// and sit the model's BASE at y=0 (so a rigid body at y=0 rests on the floor).
// Uniform-scale so the largest dimension is roughly `size` meters.
function NormalizedModel({ src, size }: { src: string; size: number }) {
  const { scene } = useGLTF(src, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const box = new Box3().setFromObject(clone)
    const dims = new Vector3()
    const center = new Vector3()
    box.getSize(dims)
    box.getCenter(center)
    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1
    const scale = size / maxDim
    // After scaling, offset so x/z are centered and the base sits at y=0.
    return {
      clone,
      scale,
      offset: new Vector3(-center.x, -box.min.y, -center.z),
    }
  }, [scene, size])

  return (
    <group scale={normalized.scale}>
      <primitive
        object={normalized.clone}
        position={[normalized.offset.x, normalized.offset.y, normalized.offset.z]}
      />
    </group>
  )
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed. If TypeScript complains that `RigidBodyType` is not exported, use the numeric enum from rapier instead: import `{ RigidBody, type RapierRigidBody }` only and replace `RigidBodyType.KinematicPositionBased` with `2` and `RigidBodyType.Dynamic` with `0` (Rapier's stable `RigidBodyType` values), removing the `RigidBodyType` import.

- [ ] **Step 6: Run the full unit suite (should be unaffected)**

Run: `npm test`
Expected: all tests pass (renderer changes don't touch store logic).

- [ ] **Step 7: Commit**

```bash
git add src/xr/SceneObjects.tsx
git commit -m "feat: solids as rigid bodies — base-on-floor, grab-kinematic, settle sync"
```

- [ ] **Step 8: Deploy and device-test (manual acceptance)**

Run:
```bash
./scripts/deploy.sh
```
Then open https://armchair-sparkle.exe.xyz/ (desktop Chrome, then Quest) and verify:
- Ask the agent for "a table with four wooden chairs" → they rest **on** the floor, not buried.
- Spawn a few boxes/spheres → they fall and settle on the ground and stack/collide.
- Grab an object and release it mid-air → it drops and settles; the agent can still refer to it.
- Say "turn off gravity" → existing objects stop falling / hang in place; new ones don't fall.
- Say "turn gravity back on" → they fall again.
- Say "disable collisions" → objects pass through each other but still rest on the floor.
- Floating text/image panels remain where placed (unaffected by gravity).

---

## Task 7: Agent avatar follows the user (lower-right, ~40% smaller)

Renderer task — typecheck/build + device test.

**Files:**
- Modify: `src/xr/AgentAvatar.tsx`

- [ ] **Step 1: Make the avatar lazily follow the camera and shrink it**

Edit `src/xr/AgentAvatar.tsx`. Update imports to add `Vector3` and `Quaternion`:
```typescript
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, MathUtils, Quaternion, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import type { RealtimeStatus } from '../agent/realtime'
import { sampleAgentLevel } from '../agent/agentAudio'
import { SettingsPanel } from './SettingsPanel'
```

Shrink the radius (~40% smaller):
```typescript
const RADIUS = 0.13
```

Add a follow offset constant below `RADIUS` — down, right, and slightly in front of the head (head looks toward -z, so "in front" is -z; "right" is +x; "down" is -y):
```typescript
// Where the companion hovers relative to the user's head: down, to the right, and
// a little in front, so it sits at the lower-right of the field of view.
const FOLLOW_OFFSET = new Vector3(0.45, -0.35, -0.7)
```

Replace the `group` ref and `useFrame` so the whole avatar group lazily tracks the camera. Change the component to hold a group ref and move it each frame:
```typescript
  const [showSettings, setShowSettings] = useState(false)
  const groupRef = useRef<Group>(null)
  const coreRef = useRef<Mesh>(null)
  const level = useRef(0)
  const targetColor = useMemo(() => new Color(STATE_COLOR[status]), [status])

  // Reused scratch objects (avoid per-frame allocation).
  const desired = useMemo(() => new Vector3(), [])
  const camQuat = useMemo(() => new Quaternion(), [])

  useFrame((state, dt) => {
    // --- Lazy body-follow: glide toward a point at the lower-right of the view. ---
    const group = groupRef.current
    if (group) {
      const cam = state.camera
      cam.getWorldQuaternion(camQuat)
      desired.copy(FOLLOW_OFFSET).applyQuaternion(camQuat).add(cam.position)
      // Smooth catch-up: fast enough to keep up, slow enough to "glide".
      const k = 1 - Math.exp(-6 * dt)
      group.position.lerp(desired, k)
      // Face the user.
      group.quaternion.slerp(camQuat, k)
    }

    // --- State color + speaking pulse (unchanged behavior). ---
    const speaking = status === 'connected' ? sampleAgentLevel() : 0
    level.current = MathUtils.damp(level.current, speaking, 6, dt)

    const t = state.clock.elapsedTime
    const breathe = Math.sin(t * 1.4) * 0.02
    const pulse = level.current * 0.8
    const connectingFlash = status === 'connecting' ? Math.abs(Math.sin(t * 4)) * 0.6 : 0

    const core = coreRef.current
    if (core) {
      core.scale.setScalar(1 + breathe + pulse)
      const mat = core.material as MeshStandardMaterial
      mat.color.lerp(targetColor, 0.12)
      mat.emissive.lerp(targetColor, 0.12)
      mat.emissiveIntensity = 0.7 + pulse * 2.6 + connectingFlash
    }
  })
```

Change the returned root group to use the ref and drop the fixed position (the frame loop now positions it). Replace `<group position={[0, 1.4, -1.6]}>` with:
```tsx
    <group ref={groupRef}>
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/xr/AgentAvatar.tsx
git commit -m "feat: agent avatar lazily follows the user, lower-right, 40% smaller"
```

- [ ] **Step 4: Deploy and device-test (manual acceptance)**

Run: `./scripts/deploy.sh`, then at https://armchair-sparkle.exe.xyz/:
- The avatar hovers at the **lower-right** of your view and is noticeably smaller (~40%).
- Walk/teleport and turn your head → it **glides** to catch up, settling at your lower-right, without jittering on small head movements.
- Click it → the settings panel still opens and start/stop voice still works.

---

## Final verification

- [ ] **Step 1: Full local gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all unit tests pass (existing + new geometry/store/handler tests), build succeeds.

- [ ] **Step 2: Update STATUS.md**

In `STATUS.md`, under "Phases completed," add a line noting physics + positioning, and remove now-stale notes if appropriate. Suggested addition:
```
- **Physics & positioning** Grid is now solid ground at y=0; solids (primitives + models)
  rest on it with gravity + collision (on by default, toggle via set_physics); models/primitives
  no longer bury. Agent avatar follows the user at the lower-right of view, ~40% smaller.
```
Also update the "Agent tools" list to include `set_physics`.

- [ ] **Step 3: Commit**

```bash
git add STATUS.md
git commit -m "docs: note physics + positioning work in STATUS"
```

- [ ] **Step 4: Push**

```bash
git push
```
Expected: branch `effort-a-positioning-physics` updates; PR #8 reflects the new commits.

---

## Self-review notes (addressed)

- **Spec coverage:** ground@0 (Task 5), base-on-floor for primitives (Tasks 2–3) and models (Task 6 Step 4), gravity+collision on by default (Tasks 3, 5, 6), `set_physics` voice toggle (Task 4), drop-&-settle on release (Task 6 Step 3), panels exempt (Task 6 Step 2), avatar lazy-follow + 40% smaller (Task 7). All covered.
- **ESM gotcha:** flagged the `require` pitfall in Task 6 and provided the top-level `Euler` import replacement.
- **API risk:** `RigidBodyType` import has a numeric-fallback note (Task 6 Step 5).
- **Type consistency:** `setPhysics(patch: Partial<PhysicsState>)`, `physics: { gravity, collision }`, `solidHalfHeight`, `isSolidKind`, `OBJECT_GROUPS`/`OBJECT_GROUPS_NO_COLLIDE`/`FLOOR_GROUPS` used consistently across store, handler, Scene, and SceneObjects.
