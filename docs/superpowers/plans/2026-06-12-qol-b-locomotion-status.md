# PR-B: Locomotion & Status HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix intermittent loss of teleport (ground plane occludes the teleport target), add thumbstick **hop** (left stick) + **snap-turn** (right stick, 45°), and add a floating **status bubble** above the avatar that surfaces async work (texture/model/image generation, text additions).

**Architecture:** A new `Locomotion` component inside `<XR>` polls controller thumbstick axes each frame and drives lifted `playerPos`/`playerYaw` state in `App`. The `create_ground` plane becomes a `TeleportTarget` so teleport survives ground creation. A transient `activities` list in the store is rendered by a `StatusBubble` inside the avatar group; `handleToolCall` emits begin/end/toast events around async tools. Pure math (snap-turn pivot) is unit-tested; XR/R3F is verified on the Quest + desktop.

**Tech Stack:** React + TS, @react-three/fiber v8, @react-three/xr v6, @react-three/drei, zustand, three, vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-qol-environment-locomotion-design.md`

**Branch:** `qol-locomotion-status` off `main` (create after PR-A is merged; or stack on `qol-environment-objects` if PR-A isn't merged yet — per repo convention).

---

### Task 1: Snap-turn pivot math (pure helper)

**Files:**
- Modify: `src/scene/geometry.ts`
- Test: `src/scene/geometry.test.ts`

Snap-turn must rotate the player **about their head**, not the origin (feet), so the head's world XZ stays fixed while yaw changes. This is the only non-obvious math; isolate + test it.

- [ ] **Step 1: Write the failing test**

Add to `src/scene/geometry.test.ts`:

```ts
import { pivotPlayerPosition } from './geometry'

describe('snap-turn pivot', () => {
  it('keeps the head world XZ fixed when only yaw changes (no head offset)', () => {
    // Head directly over the origin: pivoting in place must not move the feet.
    const next = pivotPlayerPosition([0, 0, 0], 0, [0, 1.6, 0], Math.PI / 4)
    expect(next[0]).toBeCloseTo(0)
    expect(next[2]).toBeCloseTo(0)
    expect(next[1]).toBe(0) // feet y unchanged
  })

  it('compensates feet position when the head is offset from the feet', () => {
    // Head 1m forward (-z) of the feet, yaw 0 → rotate 180°. The feet must swing
    // to the opposite side so the head stays at (0,_,-1).
    const next = pivotPlayerPosition([0, 0, 0], 0, [0, 1.6, -1], Math.PI)
    expect(next[0]).toBeCloseTo(0)
    expect(next[2]).toBeCloseTo(-2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/geometry.test.ts`
Expected: FAIL — `pivotPlayerPosition` not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/scene/geometry.ts`:

```ts
// Rotate a vector (x,z) about the Y axis by `a` radians (three's Y-rotation
// convention: x' = cos·x + sin·z, z' = -sin·x + cos·z).
function rotateXZ(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c * x + s * z, -s * x + c * z]
}

/** New player (feet) position so that snapping the view yaw from `yaw` to
 *  `newYaw` pivots around the head's world position `head` (keeps head XZ fixed).
 *  Feet y is preserved. Used by snap-turn so the player rotates in place. */
export function pivotPlayerPosition(
  playerPos: [number, number, number],
  yaw: number,
  head: [number, number, number],
  newYaw: number,
): [number, number, number] {
  // Head offset in the origin's local frame (un-rotate by current yaw).
  const [lx, lz] = rotateXZ(head[0] - playerPos[0], head[2] - playerPos[2], -yaw)
  // Where that local offset lands after the new yaw.
  const [wx, wz] = rotateXZ(lx, lz, newYaw)
  // Feet = head - rotated offset, keeping head fixed.
  return [head[0] - wx, playerPos[1], head[2] - wz]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/scene/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/geometry.ts src/scene/geometry.test.ts
git commit -m "feat(locomotion): pure snap-turn head-pivot helper"
```

---

### Task 2: Lift playerYaw into App

**Files:**
- Modify: `src/App.tsx`

No unit test (wiring) — verified with locomotion in Task 3.

- [ ] **Step 1: Add yaw state and pass it to XROrigin**

In `src/App.tsx`, inside `App`, add yaw state next to `playerPos`:

```tsx
  const [playerPos, setPlayerPos] = useState(() => new Vector3())
  const [playerYaw, setPlayerYaw] = useState(0)
```

Update the `XROrigin` to apply rotation, and render the (next task's) `Locomotion` inside `<XR>`:

```tsx
        <XR store={xrStore}>
          <XROrigin position={playerPos} rotation={[0, playerYaw, 0]} />
          <Locomotion
            playerPos={playerPos}
            playerYaw={playerYaw}
            onMove={setPlayerPos}
            onYaw={setPlayerYaw}
          />
          <Scene
            status={status}
            onConnect={connect}
            onDisconnect={disconnect}
            onTeleport={setPlayerPos}
          />
        </XR>
```

Add the import at the top:
```tsx
import { Locomotion } from './xr/Locomotion'
```

(`Locomotion` is created in Task 3; this file won't typecheck until then — that's fine, they commit together in Task 3.)

- [ ] **Step 2: Defer commit to Task 3** (App + Locomotion land together).

---

### Task 3: Thumbstick locomotion component (hop + snap-turn)

**Files:**
- Create: `src/xr/Locomotion.tsx`
- Modify: `src/App.tsx` (import already added in Task 2)

No unit test (XR input) — verified on the Quest. The pivot math it relies on is tested (Task 1).

- [ ] **Step 1: Create the component**

Create `src/xr/Locomotion.tsx`:

```tsx
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'
import { Vector3 } from 'three'
import { pivotPlayerPosition } from '../scene/geometry'

// Thumbstick locomotion (in addition to point-to-teleport):
//   Left stick  → hop a fixed distance in the pushed direction (relative to gaze).
//   Right stick → snap-turn the view by a fixed angle, pivoting around the head.
// Both are edge-triggered: one action per push, re-armed when the stick recenters.
const HOP_DISTANCE = 1.5
const SNAP_TURN_RADIANS = Math.PI / 4 // 45°
const STICK_ON = 0.7 // push past this to trigger
const STICK_OFF = 0.3 // fall below this to re-arm

export function Locomotion({
  playerPos,
  playerYaw,
  onMove,
  onYaw,
}: {
  playerPos: Vector3
  playerYaw: number
  onMove: (v: Vector3) => void
  onYaw: (yaw: number) => void
}) {
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')
  const hopArmed = useRef(true)
  const turnArmed = useRef(true)

  // Scratch vectors (avoid per-frame allocation).
  const head = useRef(new Vector3()).current
  const fwd = useRef(new Vector3()).current

  useFrame((state) => {
    // --- Snap-turn (right stick X) ---
    const rThumb = right?.gamepad['xr-standard-thumbstick']
    const rx = rThumb?.xAxis ?? 0
    if (turnArmed.current && Math.abs(rx) > STICK_ON) {
      const newYaw = playerYaw - Math.sign(rx) * SNAP_TURN_RADIANS
      state.camera.getWorldPosition(head)
      const next = pivotPlayerPosition(
        [playerPos.x, playerPos.y, playerPos.z],
        playerYaw,
        [head.x, head.y, head.z],
        newYaw,
      )
      onMove(new Vector3(next[0], next[1], next[2]))
      onYaw(newYaw)
      turnArmed.current = false
    } else if (Math.abs(rx) < STICK_OFF) {
      turnArmed.current = true
    }

    // --- Hop (left stick), relative to where the user is looking ---
    const lThumb = left?.gamepad['xr-standard-thumbstick']
    const lx = lThumb?.xAxis ?? 0
    const ly = lThumb?.yAxis ?? 0
    const mag = Math.hypot(lx, ly)
    if (hopArmed.current && mag > STICK_ON) {
      // Gaze-relative basis on the floor plane.
      state.camera.getWorldDirection(fwd)
      fwd.y = 0
      fwd.normalize()
      // right = up × forward = (fz, 0, -fx)
      const rX = fwd.z
      const rZ = -fwd.x
      // Push up (yAxis < 0) = forward; push right (xAxis > 0) = right.
      let dx = fwd.x * -ly + rX * lx
      let dz = fwd.z * -ly + rZ * lx
      const dLen = Math.hypot(dx, dz) || 1
      dx = (dx / dLen) * HOP_DISTANCE
      dz = (dz / dLen) * HOP_DISTANCE
      onMove(new Vector3(playerPos.x + dx, playerPos.y, playerPos.z + dz))
      hopArmed.current = false
    } else if (mag < STICK_OFF) {
      hopArmed.current = true
    }
  })

  return null
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (App.tsx import now resolves).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/xr/Locomotion.tsx
git commit -m "feat(locomotion): thumbstick hop (left) + 45° snap-turn (right)"
```

---

### Task 4: Fix teleport loss — make the ground a teleport target

**Files:**
- Modify: `src/xr/Scene.tsx`
- Modify: `src/xr/SceneObjects.tsx`

No unit test (R3F) — verified on the Quest (teleport after `create_ground`).

- [ ] **Step 1: Thread onTeleport into SceneObjects**

In `src/xr/Scene.tsx`, pass the existing `onTeleport` to `SceneObjects`. Change:

```tsx
        <SceneObjects />
```
to:
```tsx
        <SceneObjects onTeleport={onTeleport} />
```

- [ ] **Step 2: Accept + forward the prop in SceneObjects**

In `src/xr/SceneObjects.tsx`:

Add the `TeleportTarget` import:
```ts
import { TeleportTarget } from '@react-three/xr'
import type { Vector3 as ThreeVector3 } from 'three'
```

Change `SceneObjects` to take and forward the prop (merge with the Task-8/PR-A `castGlowLight` change if PR-A is stacked; shown here standalone):

```tsx
export function SceneObjects({ onTeleport }: { onTeleport: (point: ThreeVector3) => void }) {
  const objects = useScene((s) => s.objects)
  return (
    <>
      {objects.map((o) => (
        <ObjectView key={o.id} obj={o} onTeleport={onTeleport} />
      ))}
    </>
  )
}
```

Change `ObjectView` to accept `onTeleport` and pass it to `GroundBody`:

```tsx
function ObjectView({ obj, onTeleport }: { obj: SceneObject; onTeleport: (point: ThreeVector3) => void }) {
  if (obj.kind === 'ground') return <GroundBody obj={obj} onTeleport={onTeleport} />
  // …rest unchanged…
}
```

- [ ] **Step 3: Wrap the ground mesh in a TeleportTarget**

Replace `GroundBody` with a version that registers as a teleport target:

```tsx
function GroundBody({ obj, onTeleport }: { obj: SceneObject; onTeleport: (point: ThreeVector3) => void }) {
  const repeat = obj.textureRepeat ?? Math.min(40, Math.max(8, Math.round(obj.size / 4)))
  const texture = usePrimitiveTexture(obj.textureSrc, repeat)
  return (
    <TeleportTarget onTeleport={onTeleport}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={obj.position} receiveShadow>
        <planeGeometry args={[obj.size, obj.size]} />
        <meshStandardMaterial map={texture ?? undefined} color={texture ? '#ffffff' : obj.color} roughness={0.95} metalness={0} />
      </mesh>
    </TeleportTarget>
  )
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xr/Scene.tsx src/xr/SceneObjects.tsx
git commit -m "fix(locomotion): make create_ground a teleport target so teleport survives ground"
```

---

### Task 5: Activity list in the store

**Files:**
- Modify: `src/scene/store.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/store.test.ts` (new describe block). Also clear activities in the top `beforeEach`:

```ts
// add inside the existing beforeEach:
  useScene.setState({ activities: [] })
```

```ts
describe('activity feed', () => {
  it('beginActivity adds an active item and returns its id', () => {
    const id = useScene.getState().beginActivity('generating image…')
    const a = useScene.getState().activities
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id, text: 'generating image…', status: 'active' })
  })

  it('endActivity flips status and can change the text', () => {
    const id = useScene.getState().beginActivity('finding model…')
    useScene.getState().endActivity(id, 'model ready')
    expect(useScene.getState().activities[0]).toMatchObject({ id, text: 'model ready', status: 'done' })
  })

  it('endActivity can mark an error', () => {
    const id = useScene.getState().beginActivity('applying texture…')
    useScene.getState().endActivity(id, 'texture failed', 'error')
    expect(useScene.getState().activities[0].status).toBe('error')
  })

  it('toast adds a one-off done line', () => {
    const id = useScene.getState().toast('changed the sky')
    expect(useScene.getState().activities[0]).toMatchObject({ id, text: 'changed the sky', status: 'done' })
  })

  it('dismissActivity removes by id', () => {
    const id = useScene.getState().toast('added a note')
    useScene.getState().dismissActivity(id)
    expect(useScene.getState().activities).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — activity members undefined.

- [ ] **Step 3: Add the Activity type + store members**

In `src/scene/store.ts`, add near the top (after imports):

```ts
export interface Activity {
  id: string
  text: string
  status: 'active' | 'done' | 'error'
}
```

Add to the `SceneState` interface:

```ts
  /** Transient status feed shown above the avatar (loading/done/toasts). */
  activities: Activity[]
  /** Start an in-progress activity; returns its id. */
  beginActivity: (text: string) => string
  /** Finish an activity (status done/error), optionally updating its text. */
  endActivity: (id: string, text?: string, status?: 'done' | 'error') => void
  /** Add a one-off completed line (for quick actions). Returns its id. */
  toast: (text: string) => string
  /** Remove an activity by id (the HUD calls this after it expires). */
  dismissActivity: (id: string) => void
```

Add to the store object (after `objects: []` / counters; include a sequence counter for ids):

```ts
  activities: [],
  activitySeq: 0,

  beginActivity: (text) => {
    const seq = get().activitySeq + 1
    const id = `act-${seq}`
    set({ activitySeq: seq, activities: [...get().activities, { id, text, status: 'active' }] })
    return id
  },

  endActivity: (id, text, status = 'done') => {
    set({
      activities: get().activities.map((a) =>
        a.id === id ? { ...a, status, text: text ?? a.text } : a,
      ),
    })
  },

  toast: (text) => {
    const seq = get().activitySeq + 1
    const id = `act-${seq}`
    set({ activitySeq: seq, activities: [...get().activities, { id, text, status: 'done' }] })
    return id
  },

  dismissActivity: (id) => {
    set({ activities: get().activities.filter((a) => a.id !== id) })
  },
```

Add `activitySeq` to the `SceneState` interface as well:
```ts
  /** Monotonic id source for activities (internal). */
  activitySeq: number
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/store.ts src/scene/store.test.ts
git commit -m "feat(hud): transient activity feed in the scene store"
```

---

### Task 6: Emit activities from tool handlers

**Files:**
- Modify: `src/agent/toolHandlers.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/store.test.ts` inside the `activity feed` describe block:

```ts
  it('quick tools emit a toast (e.g. create_text_panel)', async () => {
    await handleToolCall('create_text_panel', { text: 'hi' })
    const texts = useScene.getState().activities.map((a) => a.text)
    expect(texts.some((t) => t.includes('note'))).toBe(true)
  })

  it('a failed image emits an active→error activity', async () => {
    // No network in tests → the fetch throws → activity ends as error.
    await handleToolCall('create_image_panel', { prompt: 'a cat' })
    const a = useScene.getState().activities
    expect(a.some((x) => x.status === 'error')).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — no activities emitted.

- [ ] **Step 3: Emit toasts for quick actions**

In `src/agent/toolHandlers.ts`, add toasts to the synchronous tools:

- `spawn_object` case — after spawning, before return:
```ts
      useScene.getState().toast(`added a ${obj.color} ${obj.kind}`)
```
- `create_text_panel` case — after spawn:
```ts
      useScene.getState().toast('added a note')
```
- `set_environment` case — before return:
```ts
      useScene.getState().toast('changed the environment')
```

- [ ] **Step 4: Wrap async tools with begin/end activities**

`create_image_panel` — wrap the generation. Just before `const resp = await fetch('/api/image'…`:
```ts
      const act = useScene.getState().beginActivity('generating image…')
```
On success (after the successful `update`):
```ts
        useScene.getState().endActivity(act, 'image ready')
```
In the `catch`:
```ts
        useScene.getState().endActivity(act, 'image failed', 'error')
```

`spawn_model` — `const act = useScene.getState().beginActivity('finding model…')` before the try; `endActivity(act, 'model ready')` on success; `endActivity(act, 'model failed', 'error')` in catch.

`apply_texture` — `const act = useScene.getState().beginActivity('applying texture…')` before the try; `endActivity(act, 'texture applied')` on success; `endActivity(act, 'texture failed', 'error')` in catch.

`create_ground` — `const act = useScene.getState().beginActivity('generating ground texture…')` immediately before the `try` that fetches the texture (only when a texture/polyhaven was requested); `endActivity(act, 'ground ready')` on success; `endActivity(act, 'ground texture failed', 'error')` in catch.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/toolHandlers.ts src/scene/store.test.ts
git commit -m "feat(hud): emit status activities from async + quick tool handlers"
```

---

### Task 7: Status bubble rendered above the avatar

**Files:**
- Create: `src/xr/StatusBubble.tsx`
- Modify: `src/xr/AgentAvatar.tsx`

No unit test (R3F) — verified in-app.

- [ ] **Step 1: Create the StatusBubble component**

Create `src/xr/StatusBubble.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useScene } from '../scene/store'

// A small floating panel above the avatar that shows recent activity (loading
// spinners for in-progress work, then a brief confirmation). Finished lines
// auto-expire; active lines persist until ended by the tool handler.
const EXPIRE_MS = 2800
const LINE_HEIGHT = 0.13
const PANEL_W = 1.1

export function StatusBubble() {
  const activities = useScene((s) => s.activities)
  const dismiss = useScene((s) => s.dismissActivity)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Schedule expiry for any settled (done/error) line not already scheduled.
  useEffect(() => {
    for (const a of activities) {
      if (a.status === 'active') continue
      if (timers.current.has(a.id)) continue
      const t = setTimeout(() => {
        timers.current.delete(a.id)
        dismiss(a.id)
      }, EXPIRE_MS)
      timers.current.set(a.id, t)
    }
  }, [activities, dismiss])

  // Clear timers on unmount.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  if (activities.length === 0) return null
  const shown = activities.slice(-4) // most recent few
  const panelH = shown.length * LINE_HEIGHT + 0.1

  return (
    <group position={[0, 0.42, 0]}>
      <mesh>
        <planeGeometry args={[PANEL_W, panelH]} />
        <meshBasicMaterial color="#10131c" transparent opacity={0.8} />
      </mesh>
      {shown.map((a, i) => {
        const y = panelH / 2 - 0.08 - i * LINE_HEIGHT
        const dot = a.status === 'active' ? '… ' : a.status === 'error' ? '✕ ' : '✓ '
        const color = a.status === 'error' ? '#ff8a8a' : a.status === 'active' ? '#ffd479' : '#8af0b0'
        return (
          <Text
            key={a.id}
            position={[0, y, 0.01]}
            fontSize={0.075}
            maxWidth={PANEL_W - 0.12}
            color={color}
            anchorX="center"
            anchorY="middle"
          >
            {dot + a.text}
          </Text>
        )
      })}
    </group>
  )
}
```

- [ ] **Step 2: Render it inside the avatar group**

In `src/xr/AgentAvatar.tsx`, import and mount it so it follows the user with the avatar:

```tsx
import { StatusBubble } from './StatusBubble'
```

Add it inside the returned `<group ref={groupRef}>`, after the core mesh (before `{showSettings && …}`):

```tsx
      <StatusBubble />
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/xr/StatusBubble.tsx src/xr/AgentAvatar.tsx
git commit -m "feat(hud): floating status bubble above the avatar"
```

---

### Task 8: Full verification + STATUS update

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Run the full check suite**

Run: `npm run typecheck && npm test -- --run && npm run build`
Expected: all PASS.

- [ ] **Step 2: Deploy**

Run: `./scripts/deploy.sh`
Expected: OK.

- [ ] **Step 3: Verify in desktop Chrome** at https://armchair-sparkle.exe.xyz/ while watching `./scripts/logs.sh -f`:
  - Ask for an image, a model, a textured ground → the status bubble shows "generating…/finding…" then "ready" and fades; quick actions ("add a note", "change the sky") show a toast.

- [ ] **Step 4: Verify in the Quest:**
  - **Teleport-after-ground:** lay down ground by voice, then point-and-teleport — it still works (the original movement-loss bug).
  - **Hop:** push the **left** stick — you jump ~1.5 m in the pushed direction relative to your gaze; one hop per push.
  - **Snap-turn:** flick the **right** stick left/right — the view rotates 45° in place (you don't drift sideways).
  - **Status bubble** renders above the avatar and faces you as it follows.

- [ ] **Step 5: Update STATUS.md**

In `STATUS.md`: under "Repo map" add `src/xr/Locomotion.tsx` and `src/xr/StatusBubble.tsx`. Under "User-side" note thumbstick hop + snap-turn. Replace the "Snap-turn intentionally skipped" line in "Not done yet". Remove/short the "Loading/status indicators" follow-up (now done). Add a Phase entry.

- [ ] **Step 6: Commit + open PR**

```bash
git add STATUS.md
git commit -m "docs: STATUS — locomotion (hop/snap-turn) + status HUD"
git push -u origin qol-locomotion-status
gh pr create --title "QoL-B: thumbstick locomotion (hop + snap-turn), teleport fix & status HUD" --body "Implements PR-B of the QoL design spec: fixes intermittent teleport loss (ground plane now a TeleportTarget), adds left-stick hop + right-stick 45° snap-turn, and a floating status bubble above the avatar surfacing async work and quick actions.

Spec: docs/superpowers/specs/2026-06-12-qol-environment-locomotion-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** movement-loss fix (Task 4), thumbstick hop (Task 3), 45° snap-turn with head-pivot (Tasks 1+3), status bubble incl. emitters for image/model/texture/ground + quick-action toasts (Tasks 5–7).
- **Type consistency:** `pivotPlayerPosition` (Task 1) is consumed verbatim in `Locomotion` (Task 3). `Activity`/`beginActivity`/`endActivity`/`toast`/`dismissActivity` names are consistent across store (Task 5), handlers (Task 6), and HUD (Task 7).
- **Stacking note:** if PR-B is branched on top of un-merged PR-A, Task 4's `SceneObjects`/`ObjectView` signature edits must be merged with PR-A Task 8's `castGlowLight` prop (add both props), not overwrite it.
- **Input-sign caveat:** if in-headset testing shows hop or snap-turn reversed, flip the sign on `-ly`/`lx` (hop) or `Math.sign(rx)` (turn) — all tuning lives at the top of `Locomotion.tsx`.
- **No placeholders:** all steps contain concrete code/commands.
