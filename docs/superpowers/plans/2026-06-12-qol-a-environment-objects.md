# PR-A: Environment & Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent change the sky color, ambient light, and fog (new `set_environment` tool), make objects glow as light sources, and stretch/squish objects non-uniformly (both folded into `update_object`).

**Architecture:** Same agent→tool→zustand store→R3F path as the rest of the app. Scene-global environment is new store state read by `Scene.tsx`. Per-object `scale` and `glow` are new `SceneObject` fields read by `SceneObjects.tsx`; colliders scale to match. Store/tool/geometry logic is unit-tested with vitest; rendering is verified in desktop Chrome + the Quest per repo convention (no three.js test harness).

**Tech Stack:** React + TS, React Three Fiber (R3F v8), @react-three/drei, @react-three/rapier v1, zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-qol-environment-locomotion-design.md`

**Branch:** `qol-environment-objects` (already created off `main`; the design spec is already committed here).

---

### Task 1: Environment state in the store

**Files:**
- Modify: `src/scene/types.ts`
- Modify: `src/scene/store.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/store.test.ts` (new describe block, after the `set_physics tool` block):

```ts
describe('environment state', () => {
  it('defaults to the prior hardcoded scene values', () => {
    expect(useScene.getState().environment).toEqual({
      skyColor: '#0a0a0f',
      ambientIntensity: 0.4,
      fog: true,
    })
  })

  it('setEnvironment merges partial patches, leaving other fields unchanged', () => {
    useScene.getState().setEnvironment({ skyColor: '#88bbff' })
    expect(useScene.getState().environment).toEqual({
      skyColor: '#88bbff',
      ambientIntensity: 0.4,
      fog: true,
    })
    useScene.getState().setEnvironment({ ambientIntensity: 1.2, fog: false })
    expect(useScene.getState().environment).toEqual({
      skyColor: '#88bbff',
      ambientIntensity: 1.2,
      fog: false,
    })
  })
})
```

Also reset environment in the existing `beforeEach` so tests don't leak (edit the top `beforeEach`):

```ts
beforeEach(() => {
  useScene.getState().clear()
  useScene.getState().setPhysics({ gravity: true, collision: true })
  useScene.getState().setEnvironment({ skyColor: '#0a0a0f', ambientIntensity: 0.4, fog: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — `environment` / `setEnvironment` undefined.

- [ ] **Step 3: Add the type**

In `src/scene/types.ts`, add after `PhysicsState`:

```ts
/** Scene-global environment, controlled by the agent's set_environment tool. */
export interface EnvironmentState {
  /** Background + fog color (CSS string). */
  skyColor: string
  /** Ambient light intensity (~0..3). Raise to brighten dark/distant models. */
  ambientIntensity: number
  /** Whether distance fog is drawn (fog color follows skyColor). */
  fog: boolean
}
```

- [ ] **Step 4: Add state + action to the store**

In `src/scene/store.ts`:

Import the type (add to the existing types import):
```ts
import type { Attribution, EnvironmentState, ObjectKind, PhysicsState, SceneObject } from './types'
```

Add to the `SceneState` interface (after the physics members):
```ts
  /** Scene-global environment (sky color, ambient light, fog). */
  environment: EnvironmentState
  /** Update one or more environment fields; omitted fields are left unchanged. */
  setEnvironment: (patch: Partial<EnvironmentState>) => EnvironmentState
```

Add to the store object (after `physics: { gravity: true, collision: true },`):
```ts
  environment: { skyColor: '#0a0a0f', ambientIntensity: 0.4, fog: true },
```

Add the action (after `setPhysics`):
```ts
  setEnvironment: (patch) => {
    const next: EnvironmentState = { ...get().environment, ...patch }
    set({ environment: next })
    return next
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scene/types.ts src/scene/store.ts src/scene/store.test.ts
git commit -m "feat(env): environment state (sky color, ambient, fog) in the scene store"
```

---

### Task 2: `set_environment` tool

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `src/agent/toolHandlers.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/store.test.ts` inside the `environment state` describe block:

```ts
  it('set_environment tool applies a partial patch and reports state', async () => {
    const r = (await handleToolCall('set_environment', { skyColor: '#223366', ambientIntensity: 1 })) as {
      ok: boolean
      environment: { skyColor: string; ambientIntensity: number; fog: boolean }
      scene: string
    }
    expect(r.ok).toBe(true)
    expect(r.environment).toEqual({ skyColor: '#223366', ambientIntensity: 1, fog: true })
    expect(typeof r.scene).toBe('string')
    expect(useScene.getState().environment.skyColor).toBe('#223366')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — unknown tool `set_environment` returns `{ ok: false }`.

- [ ] **Step 3: Add the tool schema**

In `src/agent/tools.ts`, add this entry to `TOOL_DEFINITIONS` (place after the `set_physics` entry):

```ts
  {
    type: 'function',
    name: 'set_environment',
    description:
      'Change the overall environment of the space: the sky/background color, how bright the ambient light is, and whether distance fog (haze) is shown. Raise ambientIntensity (toward ~1) when objects or models look too dark — especially ones that are far away or high up. Set only the field(s) the person asked to change.',
    parameters: {
      type: 'object',
      properties: {
        skyColor: { type: 'string', description: 'CSS color or hex for the sky/background (and fog), e.g. "#88bbff", "skyblue", "black".' },
        ambientIntensity: { type: 'number', description: 'Ambient brightness ~0..3. Default 0.4. Raise to ~1 to brighten dark models, lower toward 0 for a darker mood.' },
        fog: { type: 'boolean', description: 'Whether distance haze is drawn. Defaults on.' },
      },
    },
  },
```

- [ ] **Step 4: Add the handler**

In `src/agent/toolHandlers.ts`, add a case (place after the `set_physics` case):

```ts
    case 'set_environment': {
      const patch: Partial<import('../scene/types').EnvironmentState> = {}
      if (typeof args.skyColor === 'string') patch.skyColor = args.skyColor
      if (typeof args.ambientIntensity === 'number') patch.ambientIntensity = Math.max(0, args.ambientIntensity)
      if (typeof args.fog === 'boolean') patch.fog = args.fog
      const environment = scene.setEnvironment(patch)
      return { ok: true, environment, scene: useScene.getState().summary() }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools.ts src/agent/toolHandlers.ts src/scene/store.test.ts
git commit -m "feat(env): set_environment tool (sky color, ambient light, fog)"
```

---

### Task 3: Render environment from the store

**Files:**
- Modify: `src/xr/Scene.tsx`

No unit test (R3F rendering) — verified in-app at the end.

- [ ] **Step 1: Read environment in Scene**

In `src/xr/Scene.tsx`, inside the `Scene` component body, add next to the existing `gravity` selector:

```ts
  const env = useScene((s) => s.environment)
```

- [ ] **Step 2: Drive background, fog, and ambient light from it**

Replace these three lines:

```tsx
      <color attach="background" args={['#0a0a0f']} />
      <fog attach="fog" args={['#0a0a0f', 6, 22]} />

      <ambientLight intensity={0.4} />
```

with:

```tsx
      <color attach="background" args={[env.skyColor]} />
      {env.fog && <fog attach="fog" args={[env.skyColor, 6, 22]} />}

      <ambientLight intensity={env.ambientIntensity} />
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (large-chunk warnings are normal).

- [ ] **Step 4: Commit**

```bash
git add src/xr/Scene.tsx
git commit -m "feat(env): render sky color, ambient light, and fog from the store"
```

---

### Task 4: Per-axis scale + scaled colliders (geometry helpers)

**Files:**
- Modify: `src/scene/geometry.ts`
- Test: `src/scene/geometry.test.ts`

This task adds pure helpers; Task 5 wires them into the renderer.

- [ ] **Step 1: Write the failing test**

Add to `src/scene/geometry.test.ts` (new describe block):

```ts
import { effectiveScale, scaledColliderArgs } from './geometry'

describe('per-axis scale helpers', () => {
  it('effectiveScale multiplies size by per-axis scale, defaulting to uniform', () => {
    expect(effectiveScale(0.5)).toEqual([0.5, 0.5, 0.5])
    expect(effectiveScale(0.5, [2, 1, 0.5])).toEqual([1, 0.5, 0.25])
  })

  it('box collider half-extents scale per axis', () => {
    const c = scaledColliderArgs('box', [1, 2, 0.5])
    expect(c).toEqual({ shape: 'cuboid', args: [0.5, 1, 0.25] })
  })

  it('sphere collider uses the mean scaled radius (no ellipsoid in rapier)', () => {
    const c = scaledColliderArgs('sphere', [1, 2, 3])
    // unit sphere radius 0.6; mean of (0.6,1.2,1.8) = 1.2
    expect(c).toEqual({ shape: 'ball', args: [1.2] })
  })

  it('cylinder collider: half-height from y, radius from mean of x/z', () => {
    const c = scaledColliderArgs('cylinder', [2, 1, 2])
    // halfHeight 0.5*y=0.5 ; radius 0.5*mean(2,2)=1
    expect(c).toEqual({ shape: 'cylinder', args: [0.5, 1] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/geometry.test.ts`
Expected: FAIL — `effectiveScale` / `scaledColliderArgs` not exported.

- [ ] **Step 3: Implement the helpers**

Add to `src/scene/geometry.ts`:

```ts
/** Per-axis world scale of a solid: its uniform `size` times optional per-axis
 *  stretch multipliers (default [1,1,1]). Mirrors the mesh scale in SceneObjects. */
export function effectiveScale(size: number, scale?: [number, number, number]): [number, number, number] {
  const s = scale ?? [1, 1, 1]
  return [size * s[0], size * s[1], size * s[2]]
}

export type ColliderSpec =
  | { shape: 'cuboid'; args: [number, number, number] }
  | { shape: 'ball'; args: [number] }
  | { shape: 'cylinder'; args: [number, number] } // [halfHeight, radius]
  | { shape: 'cone'; args: [number, number] } // [halfHeight, radius]

// Analytic collider for a primitive given its already-scaled per-axis extents
// [ex,ey,ez] (= effectiveScale). Matches the unit geometries in SceneObjects
// (sphere r=0.6, cylinder/cone h=1 r=0.5/0.6, torus outer=0.7 tube~0.2, box=1).
// A sphere/cylinder/cone has no exact non-uniform collider in rapier, so radial
// dims use the mean of the relevant axes — a documented approximation.
export function scaledColliderArgs(kind: ObjectKind, e: [number, number, number]): ColliderSpec {
  const [ex, ey, ez] = e
  switch (kind) {
    case 'sphere':
      return { shape: 'ball', args: [0.6 * ((ex + ey + ez) / 3)] }
    case 'cylinder':
      return { shape: 'cylinder', args: [0.5 * ey, 0.5 * ((ex + ez) / 2)] }
    case 'cone':
      return { shape: 'cone', args: [0.5 * ey, 0.6 * ((ex + ez) / 2)] }
    case 'torus':
      return { shape: 'cuboid', args: [0.7 * ex, 0.7 * ey, 0.2 * ez] }
    case 'box':
    default:
      return { shape: 'cuboid', args: [0.5 * ex, 0.5 * ey, 0.5 * ez] }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/scene/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/geometry.ts src/scene/geometry.test.ts
git commit -m "feat(transform): per-axis scale + scaled collider helpers"
```

---

### Task 5: `scale` + `glow` fields, store passthrough, and summary

**Files:**
- Modify: `src/scene/types.ts`
- Modify: `src/scene/store.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/store.test.ts` (new describe block):

```ts
describe('scale & glow', () => {
  it('persists per-axis scale and glow on spawn and update', () => {
    const o = useScene.getState().spawn({ kind: 'box', scale: [2, 1, 0.5], glow: 1.5 })
    expect(o.scale).toEqual([2, 1, 0.5])
    expect(o.glow).toBe(1.5)
    const u = useScene.getState().update(o.id, { scale: [1, 3, 1], glow: 0 })
    expect(u?.scale).toEqual([1, 3, 1])
    expect(u?.glow).toBe(0)
  })

  it('summary reflects stretched and glowing objects', () => {
    useScene.getState().spawn({ kind: 'box', color: 'red', scale: [3, 1, 1], glow: 2 })
    const s = useScene.getState().summary()
    expect(s).toContain('stretched')
    expect(s).toContain('glowing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — `scale`/`glow` not on the object / not in summary.

- [ ] **Step 3: Add the fields to the type**

In `src/scene/types.ts`, add to `SceneObject` (after `roughness?`):

```ts
  /** Per-axis stretch/squish multipliers on top of `size`. Default [1,1,1]. */
  scale?: [number, number, number]
  /** Light emission strength. 0/undefined = none. >0 = emissive + a point light. */
  glow?: number
```

- [ ] **Step 4: Thread through the store**

In `src/scene/store.ts`:

Add to `MaterialFields` interface (so both spawn + update inherit them):
```ts
  scale?: [number, number, number]
  glow?: number
```

In `spawn`, add to the `obj` literal (after `roughness: args.roughness,`):
```ts
      scale: args.scale,
      glow: args.glow,
```

In `update`, add (after the `roughness` line):
```ts
    if (patch.scale !== undefined) next.scale = patch.scale
    if (patch.glow !== undefined) next.glow = patch.glow
```

In `summary()`, extend the primitive `desc` branch. Replace:
```ts
      else {
        const finish = o.textureSrc ? ' textured' : o.materialPreset ? ` ${o.materialPreset}` : ''
        desc = `${o.color} ${o.kind}${finish}`
      }
```
with:
```ts
      else {
        const finish = o.textureSrc ? ' textured' : o.materialPreset ? ` ${o.materialPreset}` : ''
        const stretched = o.scale && (o.scale[0] !== o.scale[1] || o.scale[1] !== o.scale[2]) ? ' stretched' : ''
        const glowing = o.glow && o.glow > 0 ? ' glowing' : ''
        desc = `${o.color} ${o.kind}${finish}${stretched}${glowing}`
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scene/types.ts src/scene/store.ts src/scene/store.test.ts
git commit -m "feat(transform/glow): scale + glow fields with store passthrough and summary"
```

---

### Task 6: Extend `update_object` tool with `scale` + `glow`

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `src/agent/toolHandlers.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/store.test.ts` inside the `scale & glow` describe block:

```ts
  it('update_object tool applies scale and glow', async () => {
    const box = useScene.getState().spawn({ kind: 'box' })
    const r = (await handleToolCall('update_object', { id: box.id, scale: [1, 2.5, 1], glow: 1 })) as { ok: boolean }
    expect(r.ok).toBe(true)
    const got = useScene.getState().objects[0]
    expect(got.scale).toEqual([1, 2.5, 1])
    expect(got.glow).toBe(1)
  })

  it('update_object ignores a malformed scale (not 3 numbers)', async () => {
    const box = useScene.getState().spawn({ kind: 'box' })
    await handleToolCall('update_object', { id: box.id, scale: [1, 2] })
    expect(useScene.getState().objects[0].scale).toBeUndefined()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — scale/glow not applied by the handler.

- [ ] **Step 3: Add the tool params**

In `src/agent/tools.ts`, in the `update_object` entry's `properties`, add (after the `rotation` property):

```ts
        scale: {
          type: 'array',
          description:
            'Absolute per-axis stretch multipliers [x, y, z]. 1 = unchanged, 2 = twice as long on that axis, 0.5 = squished to half. Use to stretch or squish an object (e.g. [1, 3, 1] makes it tall and thin).',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
        },
        glow: {
          type: 'number',
          description:
            'Make the object emit light (be a light source). 0 = off. ~1 = soft like a candle, higher (~3+) = bright like a lamp or sun. The glow takes the object\'s color.',
        },
```

- [ ] **Step 4: Apply scale + glow in the handler**

In `src/agent/toolHandlers.ts`, in the `update_object` case, between destructuring and the `scene.update` call, build a sanitized patch. Replace:

```ts
    case 'update_object': {
      const { id, ...patch } = args as unknown as { id: string } & UpdateArgs
      const obj = scene.update(id, patch)
```

with:

```ts
    case 'update_object': {
      const { id, ...rest } = args as unknown as { id: string } & UpdateArgs & {
        scale?: unknown
        glow?: unknown
      }
      const patch = rest as UpdateArgs
      if (Array.isArray(rest.scale) && rest.scale.length === 3 && rest.scale.every((n) => typeof n === 'number')) {
        patch.scale = rest.scale as [number, number, number]
      } else {
        delete patch.scale
      }
      if (typeof rest.glow === 'number') patch.glow = Math.max(0, rest.glow)
      else delete patch.glow
      const obj = scene.update(id, patch)
```

(The rest of the case — the `return obj ? … : …` — is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools.ts src/agent/toolHandlers.ts src/scene/store.test.ts
git commit -m "feat(transform/glow): update_object accepts scale and glow"
```

---

### Task 7: Render per-axis scale + scaled colliders

**Files:**
- Modify: `src/xr/SceneObjects.tsx`

No unit test (R3F) — verified in-app.

- [ ] **Step 1: Import the helpers**

In `src/xr/SceneObjects.tsx`, update the geometry import:

```ts
import {
  isSolidKind,
  OBJECT_GROUPS,
  OBJECT_GROUPS_NO_COLLIDE,
  effectiveScale,
  scaledColliderArgs,
} from '../scene/geometry'
```

- [ ] **Step 2: Scale the primitive mesh per-axis**

In `PrimitiveBody`, replace `<mesh scale={obj.size} castShadow>` with:

```tsx
  const e = effectiveScale(obj.size, obj.scale)
  return (
    <mesh scale={e} castShadow>
```

(Move the `const e = …` above the existing `const texture = …` line; keep the rest of the body intact.)

- [ ] **Step 3: Scale the model wrapper per-axis**

In `NormalizedModel`, the returned group currently does `scale={normalized.scale}` (a single number). Models should keep their normalized uniform fit but also honor the agent's per-axis stretch. Pass `scale` in and multiply.

Change the `NormalizedModel` props to accept `scale`:
```tsx
function NormalizedModel({
  src,
  size,
  scale,
  textureSrc,
  textureRepeat,
}: {
  src: string
  size: number
  scale?: [number, number, number]
  textureSrc?: string
  textureRepeat?: number
}) {
```

Replace the return's group scale:
```tsx
  const s = scale ?? [1, 1, 1]
  return (
    <group scale={[normalized.scale * s[0], normalized.scale * s[1], normalized.scale * s[2]]}>
```

In `ModelBody`, pass it through:
```tsx
        <NormalizedModel src={obj.src} size={obj.size} scale={obj.scale} textureSrc={obj.textureSrc} textureRepeat={obj.textureRepeat} />
```

- [ ] **Step 4: Scale the colliders per-axis**

Replace `PrimitiveCollider` entirely with a version driven by `scaledColliderArgs`:

```tsx
function PrimitiveCollider({ kind, size, scale }: { kind: ObjectKind; size: number; scale?: [number, number, number] }) {
  const spec = scaledColliderArgs(kind, effectiveScale(size, scale))
  switch (spec.shape) {
    case 'ball':
      return <BallCollider args={spec.args} />
    case 'cylinder':
      return <CylinderCollider args={spec.args} />
    case 'cone':
      return <ConeCollider args={spec.args} />
    case 'cuboid':
    default:
      return <CuboidCollider args={spec.args} />
  }
}
```

In `PhysicsObject`, update the two collider sites. The model box collider (replace the `isModel ?` branch):

```tsx
        {isModel ? (
          (() => {
            const [ex, ey, ez] = effectiveScale(obj.size, obj.scale)
            return <CuboidCollider args={[ex * 0.35, ey * 0.5, ez * 0.35]} position={[0, ey * 0.5, 0]} />
          })()
        ) : (
          <PrimitiveCollider kind={obj.kind} size={obj.size} scale={obj.scale} />
        )}
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xr/SceneObjects.tsx
git commit -m "feat(transform): render per-axis scale with matching scaled colliders"
```

---

### Task 8: Render glow (emissive + capped point lights)

**Files:**
- Modify: `src/xr/SceneObjects.tsx`

No unit test (R3F) — verified in-app.

- [ ] **Step 1: Add glow lighting helpers + the active-glow set**

At the top of `src/xr/SceneObjects.tsx` (after the imports), add:

```ts
// Glow point-light tuning. WebGL has a finite dynamic-light budget, so cap how
// many glowing objects actually cast light; extras stay emissive-only.
const MAX_GLOW_LIGHTS = 6
const glowLightIntensity = (glow: number) => glow * 4
const glowLightDistance = (glow: number) => 3 + glow * 3
```

In `SceneObjects`, compute which objects may cast a glow light (first N by store order) and pass it down:

```tsx
export function SceneObjects() {
  const objects = useScene((s) => s.objects)
  const glowing = objects.filter((o) => (o.glow ?? 0) > 0)
  const lightIds = new Set(glowing.slice(0, MAX_GLOW_LIGHTS).map((o) => o.id))
  if (glowing.length > MAX_GLOW_LIGHTS) {
    logGlowCap(glowing.length)
  }
  return (
    <>
      {objects.map((o) => (
        <ObjectView key={o.id} obj={o} castGlowLight={lightIds.has(o.id)} />
      ))}
    </>
  )
}
```

Add the (best-effort, browser-only) log helper near the top:

```ts
let loggedGlowCap = 0
function logGlowCap(count: number): void {
  if (typeof window === 'undefined' || count === loggedGlowCap) return
  loggedGlowCap = count
  void fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'glow_light_cap', data: { glowing: count, cap: MAX_GLOW_LIGHTS } }),
  }).catch(() => {})
}
```

- [ ] **Step 2: Thread `castGlowLight` through ObjectView and emit the light**

Change `ObjectView` signature and add the point light. Replace the whole `ObjectView` function with:

```tsx
function ObjectView({ obj, castGlowLight }: { obj: SceneObject; castGlowLight: boolean }) {
  // The ground is static scenery — rendered directly (no grab/physics wrapper).
  if (obj.kind === 'ground') return <GroundBody obj={obj} />

  let body: ReactNode
  if (obj.kind === 'text') body = <TextBody obj={obj} />
  else if (obj.kind === 'image') body = <ImageBody obj={obj} />
  else if (obj.kind === 'model') body = <ModelBody obj={obj} />
  else body = <PrimitiveBody obj={obj} />

  const wrapped = isSolidKind(obj.kind) ? (
    <PhysicsObject obj={obj}>{body}</PhysicsObject>
  ) : (
    <GrabbableObject obj={obj}>{body}</GrabbableObject>
  )

  const glow = obj.glow ?? 0
  return (
    <>
      {wrapped}
      {castGlowLight && glow > 0 && (
        <pointLight
          position={obj.position}
          color={obj.color}
          intensity={glowLightIntensity(glow)}
          distance={glowLightDistance(glow)}
          decay={2}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Emissive on primitives**

In `PrimitiveBody`, update the `<meshPhysicalMaterial>` to add emissive props. Replace the material block:

```tsx
      <meshPhysicalMaterial
        color={texture ? '#ffffff' : obj.color}
        map={texture ?? undefined}
        metalness={metalness}
        roughness={roughness}
        transmission={preset.transmission}
        clearcoat={preset.clearcoat}
        transparent={preset.transmission > 0}
        ior={1.5}
        emissive={obj.glow ? obj.color : '#000000'}
        emissiveIntensity={obj.glow ?? 0}
        toneMapped={!obj.glow}
      />
```

- [ ] **Step 4: Emissive on models**

In `NormalizedModel`, add `glow` to props:
```tsx
function NormalizedModel({
  src,
  size,
  scale,
  glow,
  textureSrc,
  textureRepeat,
}: {
  src: string
  size: number
  scale?: [number, number, number]
  glow?: number
  textureSrc?: string
  textureRepeat?: number
}) {
```

In the texture `useEffect` inside `NormalizedModel`, also set emissive. Replace the loop body's material handling so it reads:

```tsx
      for (const m of mats) {
        const sm = m as MeshStandardMaterial
        if (texture) {
          sm.map = texture
          sm.color?.set('#ffffff') // let the texture provide the color
        }
        if (glow && glow > 0) {
          sm.emissive?.set(objColorForGlow)
          sm.emissiveIntensity = glow
          sm.toneMapped = false
        } else {
          sm.emissive?.set('#000000')
          sm.emissiveIntensity = 0
          sm.toneMapped = true
        }
        sm.needsUpdate = true
      }
```

The model's glow color should be the object color. `NormalizedModel` doesn't currently receive the color — pass it. Add `color` to props and to the `ModelBody` call, and use it:

In `NormalizedModel` props add `color: string`, change the effect dependency array to include `glow` and `color`, and define `const objColorForGlow = color` (or inline `color`). Update the effect deps line to:
```tsx
  }, [normalized, texture, glow, color])
```

In `ModelBody`, pass both:
```tsx
        <NormalizedModel
          src={obj.src}
          size={obj.size}
          scale={obj.scale}
          glow={obj.glow}
          color={obj.color}
          textureSrc={obj.textureSrc}
          textureRepeat={obj.textureRepeat}
        />
```

And replace `sm.emissive?.set(objColorForGlow)` with `sm.emissive?.set(color)` (drop the alias to keep it simple).

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xr/SceneObjects.tsx
git commit -m "feat(glow): emissive materials + capped color-matched point lights"
```

---

### Task 9: Full verification + STATUS update

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Run the full check suite**

Run: `npm run typecheck && npm test -- --run && npm run build`
Expected: all PASS (tests green, build emits only the known large-chunk warnings).

- [ ] **Step 2: Deploy**

Run: `./scripts/deploy.sh`
Expected: rsync + remote build + service restart + health check OK.

- [ ] **Step 3: Verify in desktop Chrome** at https://armchair-sparkle.exe.xyz/ (start talking), exercising by voice while watching `./scripts/logs.sh -f`:
  - "Make the sky light blue" → background + fog turn light blue (`set_environment` in logs).
  - "It's too dark, brighten it up" → ambient rises; a previously-dark model lightens.
  - "Turn off the fog" → haze disappears.
  - "Make the box really tall and thin" → box stretches on Y; it still rests on the floor.
  - "Make that sphere glow like a candle" → sphere glows and lights nearby objects.
  - Spawn 8 glowing objects → 7th/8th glow but cast no light; `glow_light_cap` logged.

- [ ] **Step 4: Verify in the Quest** — same checks render correctly in immersive VR (glow blooms, stretched colliders rest properly).

- [ ] **Step 5: Update STATUS.md**

In `STATUS.md`, under "Agent tools", add `set_environment` and note `update_object` now takes `scale` + `glow`. Under "Phases completed" add a short entry for this PR. Remove the now-done items from "Not done yet" as appropriate (ambient-light/brightness was implied by the dark-models note).

- [ ] **Step 6: Commit + open PR**

```bash
git add STATUS.md
git commit -m "docs: STATUS — environment, transform, and glow tools"
git push -u origin qol-environment-objects
gh pr create --title "QoL-A: environment (sky/ambient/fog), object glow & non-uniform transform" --body "Implements PR-A of the QoL design spec: new set_environment tool (sky color, ambient light, fog), object glow (emissive + capped point lights), and non-uniform stretch/squish via update_object with matching scaled colliders.

Spec: docs/superpowers/specs/2026-06-12-qol-environment-locomotion-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** sky color (Task 2/3), ambient light (Task 2/3), fog (Task 2/3), glow incl. light cap (Task 5/6/8), non-uniform transform incl. scaled colliders & sphere-mean approximation (Task 4/5/6/7). Status HUD + locomotion are in the separate PR-B plan.
- **Type consistency:** `effectiveScale`/`scaledColliderArgs`/`ColliderSpec` defined in Task 4 are consumed verbatim in Task 7. `scale`/`glow` field names are consistent across types, store, tools, and renderer.
- **No placeholders:** all steps contain concrete code/commands.
