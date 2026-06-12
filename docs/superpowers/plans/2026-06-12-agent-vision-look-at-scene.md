# Agent Vision (`look_at_scene`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the voice agent on-demand sight — a `look_at_scene` tool that captures the 3D view (or a framed shot of one object), runs it through a server-side vision model, and returns a text description the agent speaks, so it can catch problems like the wrong model loading.

**Architecture:** Client captures the R3F scene by rendering to an offscreen target (XR-safe via toggling `gl.xr.enabled`), reachable from the non-React tool handler through a singleton bridge. The handler POSTs the JPEG to a new `/api/vision` route (OpenAI vision model, key server-side), gets back a description, and returns it as the tool result. Reuses the existing status-HUD activity feed for a "looking…" indicator.

**Tech Stack:** React + TS, React Three Fiber v8, @react-three/xr v6, three 0.171, Express, OpenAI Chat Completions (vision), vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-agent-vision-look-at-scene-design.md`

**Branch:** `agent-vision-look-at-scene` (already created off `main`, which includes PR-B's status HUD; the spec is already committed here).

---

### Task 1: `framingCamera` pure helper

**Files:**
- Modify: `src/scene/geometry.ts`
- Test: `src/scene/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/scene/geometry.test.ts` (new describe block; the file already imports from `./geometry` on lines 2–3 — add `framingCamera` to the line-3 import):

```ts
import { effectiveScale, scaledColliderArgs, pivotPlayerPosition, framingCamera } from './geometry'

describe('framingCamera', () => {
  it('targets the object center, slightly raised', () => {
    const { target } = framingCamera([2, 0.5, -3], 1, [0, 1.6, 0])
    expect(target[0]).toBeCloseTo(2)
    expect(target[1]).toBeCloseTo(0.5 + 0.15) // raised by size*0.15
    expect(target[2]).toBeCloseTo(-3)
  })

  it('places the camera on the head side of the object, backed off by ~size', () => {
    // Head at origin, object 4m forward (-z). Camera should sit between them (z > -4).
    const { position } = framingCamera([0, 0, -4], 1, [0, 1.6, 0])
    expect(position[2]).toBeGreaterThan(-4) // toward the head (+z side)
    expect(position[1]).toBeGreaterThan(0) // above center
  })

  it('scales the back-off distance with object size', () => {
    const near = framingCamera([0, 0, -4], 0.5, [0, 1.6, 0]).position
    const far = framingCamera([0, 0, -4], 3, [0, 1.6, 0]).position
    // Bigger object → camera further from it (its z is closer to the head at +z).
    expect(far[2]).toBeGreaterThan(near[2])
  })

  it('falls back to +z when the head coincides with the object', () => {
    const { position } = framingCamera([1, 0, 1], 1, [1, 0, 1])
    expect(Number.isFinite(position[0])).toBe(true)
    expect(Number.isFinite(position[2])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/geometry.test.ts`
Expected: FAIL — `framingCamera` is not exported.

- [ ] **Step 3: Implement the helper**

Add to the end of `src/scene/geometry.ts`:

```ts
/** Camera placement to frame an object for a snapshot: returns the camera position
 *  and the look-at target (the object center, slightly raised). The camera sits back
 *  from the object toward the viewer (the head's XZ side), high enough and far enough
 *  that an object of the given size roughly fills a ~50° FOV. Pure — no three types. */
export function framingCamera(
  objPos: [number, number, number],
  objSize: number,
  headPos: [number, number, number],
): { position: [number, number, number]; target: [number, number, number] } {
  const dist = Math.max(0.6, objSize * 2.2)
  // Direction from the object toward the head, on the floor plane (fallback +z).
  let dx = headPos[0] - objPos[0]
  let dz = headPos[2] - objPos[2]
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) {
    dx = 0
    dz = 1
  } else {
    dx /= len
    dz /= len
  }
  const center: [number, number, number] = [objPos[0], objPos[1] + objSize * 0.15, objPos[2]]
  return {
    position: [center[0] + dx * dist, center[1] + objSize * 0.4, center[2] + dz * dist],
    target: center,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/scene/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/geometry.ts src/scene/geometry.test.ts
git commit -m "feat(vision): framingCamera helper to frame an object for a snapshot"
```

---

### Task 2: Capture bridge singleton

**Files:**
- Create: `src/xr/sceneCapture.ts`
- Test: `src/xr/sceneCapture.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/xr/sceneCapture.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { registerCapturer, captureScene } from './sceneCapture'

describe('sceneCapture bridge', () => {
  afterEach(() => registerCapturer(null))

  it('returns null when no capturer is registered', async () => {
    expect(await captureScene()).toBeNull()
  })

  it('delegates to the registered capturer with the request', async () => {
    registerCapturer(async (req) => `img:${req.focusId ?? 'forward'}`)
    expect(await captureScene({ focusId: 'model-1' })).toBe('img:model-1')
    expect(await captureScene()).toBe('img:forward')
  })

  it('returns null (never throws) if the capturer rejects', async () => {
    registerCapturer(async () => {
      throw new Error('boom')
    })
    expect(await captureScene()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/xr/sceneCapture.test.ts`
Expected: FAIL — module `./sceneCapture` does not exist.

- [ ] **Step 3: Implement the bridge**

Create `src/xr/sceneCapture.ts`:

```ts
// A tiny singleton bridge so the non-React tool handler can ask the R3F tree to
// capture a screenshot. Mirrors how the zustand store and the /api/log bridge are
// reachable from anywhere. <SceneCapture/> registers the actual capturer on mount.

export interface CaptureRequest {
  /** Object id to frame; if omitted, capture the user's forward view. */
  focusId?: string
}

type Capturer = (req: CaptureRequest) => Promise<string>

let capturer: Capturer | null = null

/** Registered by <SceneCapture/> on mount; pass null on unmount to clear. */
export function registerCapturer(fn: Capturer | null): void {
  capturer = fn
}

/** Capture the scene as a JPEG data URL. Returns null if no capturer is mounted
 *  (e.g. before the canvas exists, or in unit tests). Never throws. */
export async function captureScene(req: CaptureRequest = {}): Promise<string | null> {
  if (!capturer) return null
  try {
    return await capturer(req)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/xr/sceneCapture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xr/sceneCapture.ts src/xr/sceneCapture.test.ts
git commit -m "feat(vision): scene-capture singleton bridge"
```

---

### Task 3: `SceneCapture` component (render-to-target, XR-safe)

**Files:**
- Create: `src/xr/SceneCapture.tsx`

No unit test (R3F/WebGL) — verified by typecheck/build and manually in-app.

- [ ] **Step 1: Implement the component**

Create `src/xr/SceneCapture.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  LinearFilter,
  PerspectiveCamera,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import { useScene } from '../scene/store'
import { framingCamera } from '../scene/geometry'
import { registerCapturer, type CaptureRequest } from './sceneCapture'

// Square snapshot resolution — small enough to POST cheaply, big enough to recognize.
const SIZE = 512

interface Pending {
  req: CaptureRequest
  resolve: (dataUrl: string) => void
  reject: (err: unknown) => void
}

// Renders the live scene from a chosen camera into an offscreen target and returns a
// JPEG data URL. Registered into the capture bridge so the tool handler can call it.
// Works in immersive XR by toggling gl.xr.enabled off around the render (otherwise
// three forces the headset's stereo cameras and ignores our capture camera).
export function SceneCapture() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const mainCamera = useThree((s) => s.camera)
  const pending = useRef<Pending | null>(null)

  const kit = useMemo(() => {
    const target = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: UnsignedByteType,
    })
    const cam = new PerspectiveCamera(50, 1, 0.05, 200)
    const pixels = new Uint8Array(SIZE * SIZE * 4)
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const head = new Vector3()
    return { target, cam, pixels, canvas, ctx, head }
  }, [])

  useEffect(() => {
    registerCapturer(
      (req) =>
        new Promise<string>((resolve, reject) => {
          // Newest request wins; abandon any previous unfulfilled one.
          pending.current?.reject(new Error('superseded'))
          pending.current = { req, resolve, reject }
        }),
    )
    return () => {
      registerCapturer(null)
      kit.target.dispose()
    }
  }, [kit])

  useFrame(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const { target, cam, pixels, canvas, ctx, head } = kit
    try {
      // --- Position the capture camera ---
      mainCamera.getWorldPosition(head)
      const focus = p.req.focusId
        ? useScene.getState().objects.find((o) => o.id === p.req.focusId)
        : undefined
      if (focus) {
        const { position, target: look } = framingCamera(
          focus.position,
          focus.size,
          [head.x, head.y, head.z],
        )
        cam.position.set(position[0], position[1], position[2])
        cam.lookAt(look[0], look[1], look[2])
      } else {
        cam.position.copy(head)
        mainCamera.getWorldQuaternion(cam.quaternion)
      }
      cam.updateMatrixWorld()

      // --- Render to the offscreen target (XR-safe) ---
      const prevXr = gl.xr.enabled
      gl.xr.enabled = false
      gl.setRenderTarget(target)
      gl.render(scene, cam)
      gl.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels)
      gl.setRenderTarget(null)
      gl.xr.enabled = prevXr

      // --- Blit into a 2D canvas, flipping Y (render-target rows are bottom-up) ---
      const img = ctx.createImageData(SIZE, SIZE)
      const rowBytes = SIZE * 4
      for (let row = 0; row < SIZE; row++) {
        const src = row * rowBytes
        const dst = (SIZE - 1 - row) * rowBytes
        img.data.set(pixels.subarray(src, src + rowBytes), dst)
      }
      ctx.putImageData(img, 0, 0)
      p.resolve(canvas.toDataURL('image/jpeg', 0.8))
    } catch (err) {
      p.reject(err)
    }
  })

  return null
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (known large-chunk warnings only).

- [ ] **Step 3: Commit**

```bash
git add src/xr/SceneCapture.tsx
git commit -m "feat(vision): SceneCapture component — XR-safe render-to-target snapshot"
```

---

### Task 4: Mount `SceneCapture` in the Canvas

**Files:**
- Modify: `src/App.tsx`

No unit test (wiring) — verified by build + manually.

- [ ] **Step 1: Add the import and mount it inside `<XR>`**

In `src/App.tsx`, add the import near the other `./xr` imports:

```tsx
import { SceneCapture } from './xr/SceneCapture'
```

Inside the `<XR store={xrStore}>` block, add `<SceneCapture />` alongside the other children (e.g. just after `<Locomotion … />`, before `<Scene … />`):

```tsx
          <SceneCapture />
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(vision): mount SceneCapture in the XR canvas"
```

---

### Task 5: `/api/vision` route

**Files:**
- Create: `server/vision.ts`
- Modify: `server/index.ts`

No unit test (the repo has no server-route tests; consistent with `image.ts`/`texture.ts`) — verified by typecheck/build and manually.

- [ ] **Step 1: Create the route**

Create `server/vision.ts`:

```ts
import { Router } from 'express'

// POST /api/vision — describe an image with a vision model. The browser captures a
// screenshot of the 3D scene and posts it here; we ask the model a question about it
// and return { description }. The OpenAI key stays server-side. Mirrors image.ts.
export const visionRouter = Router()

const VISION_MODEL = process.env.VISION_MODEL ?? 'gpt-4o-mini'
const DEFAULT_Q =
  "Briefly describe what's in this image — the main objects, their kind, color, and whether anything looks broken, missing, or wrong. 1–3 sentences."

visionRouter.post('/vision', async (req, res) => {
  const { image, question } = (req.body ?? {}) as { image?: unknown; question?: unknown }
  if (typeof image !== 'string' || !/^data:image\//.test(image)) {
    res.status(400).json({ error: 'Provide an "image" data URL.' })
    return
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' })
    return
  }
  const q = typeof question === 'string' && question ? question : DEFAULT_Q
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: q },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        max_tokens: 300,
      }),
    })
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    if (!r.ok) {
      console.error('Vision error', json)
      res.status(502).json({ error: json?.error?.message ?? 'Vision request failed' })
      return
    }
    const description = json?.choices?.[0]?.message?.content?.trim()
    if (!description) {
      res.status(502).json({ error: 'No description returned' })
      return
    }
    console.log(`[vision] ${description.slice(0, 80)}`)
    res.json({ description })
  } catch (err) {
    console.error('Vision request error', err)
    res.status(500).json({ error: 'Vision request failed' })
  }
})
```

- [ ] **Step 2: Mount it in `server/index.ts`**

Add the import next to the other routers:
```ts
import { visionRouter } from './vision.ts'
```

Mount it next to the image router (after the `app.use('/api', imageRouter)` line):
```ts
  // Vision: describe a screenshot of the 3D scene (look_at_scene tool).
  app.use('/api', visionRouter)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/vision.ts server/index.ts
git commit -m "feat(vision): /api/vision route (server-side vision model)"
```

---

### Task 6: `look_at_scene` tool + handler

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `src/agent/toolHandlers.ts`
- Test: `src/scene/store.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/scene/store.test.ts`, extend the vitest import on line 1 to include `vi`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
```
Add an import for the capture bridge near the top imports:
```ts
import { registerCapturer } from '../xr/sceneCapture'
```
Add a new describe block:

```ts
describe('look_at_scene', () => {
  afterEach(() => {
    registerCapturer(null)
    vi.unstubAllGlobals()
  })

  it('captures, asks the vision route, and returns the description', async () => {
    registerCapturer(async () => 'data:image/jpeg;base64,AAAA')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ description: 'a yellow rubber duck' }) })),
    )
    const r = (await handleToolCall('look_at_scene', { question: 'what is this?' })) as {
      ok: boolean
      description: string
    }
    expect(r.ok).toBe(true)
    expect(r.description).toContain('duck')
    // an activity was emitted and ended (not left active)
    expect(useScene.getState().activities.some((a) => a.status === 'active')).toBe(false)
  })

  it('returns a clean error when no view is available (no capturer)', async () => {
    registerCapturer(null)
    const r = (await handleToolCall('look_at_scene', {})) as { ok: boolean }
    expect(r.ok).toBe(false)
  })

  it('errors on an unknown focus id without capturing', async () => {
    const r = (await handleToolCall('look_at_scene', { focus: 'ghost-1' })) as { ok: boolean }
    expect(r.ok).toBe(false)
  })
})
```

Add `afterEach` to the vitest import on line 1 as well:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: FAIL — `look_at_scene` is an unknown tool (`{ ok: false }` for the success case assertion `description` undefined).

- [ ] **Step 3: Add the tool schema**

In `src/agent/tools.ts`, add to `TOOL_DEFINITIONS` (place after `list_scene` / before `clear_scene`, or anywhere in the array):

```ts
  {
    type: 'function',
    name: 'look_at_scene',
    description:
      "Actually look at the space with your own eyes by taking a snapshot and seeing what's really there. Use this to check that a model or image you added matches what was asked (the right model doesn't always load), or when the person asks what's in the scene or whether something looks right. Pass focus with an object id (e.g. \"model-1\") to look closely at that one thing; omit it to look at whatever is in front of the person.",
    parameters: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Object id to inspect up close, e.g. "model-1".' },
        question: { type: 'string', description: 'What you want to check, e.g. "is this a wooden chair?".' },
      },
    },
  },
```

- [ ] **Step 4: Add the handler**

In `src/agent/toolHandlers.ts`, add the import at the top (next to the other imports):
```ts
import { captureScene } from '../xr/sceneCapture'
```

Add the case (place before `case 'list_scene':`):

```ts
    case 'look_at_scene': {
      const focus = typeof args.focus === 'string' ? args.focus : undefined
      const question = typeof args.question === 'string' ? args.question : undefined
      if (focus && !objectExists(focus)) {
        return { ok: false, error: `No object with id "${focus}".`, scene: scene.summary() }
      }
      const act = useScene.getState().beginActivity('looking at the scene…')
      try {
        const image = await captureScene({ focusId: focus })
        if (!image) {
          useScene.getState().endActivity(act, "couldn't capture view", 'error')
          return { ok: false, error: 'Could not capture the scene (no active view).', scene: scene.summary() }
        }
        const resp = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image, question }),
        })
        const json = (await resp.json()) as { description?: string; error?: string }
        if (!resp.ok || !json.description) throw new Error(json.error ?? `vision failed (${resp.status})`)
        useScene.getState().endActivity(act, 'looked at the scene')
        return { ok: true, description: json.description, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().endActivity(act, 'look failed', 'error')
        return { ok: false, error: String(err), scene: scene.summary() }
      }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/scene/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools.ts src/agent/toolHandlers.ts src/scene/store.test.ts
git commit -m "feat(vision): look_at_scene tool — capture + vision + describe"
```

---

### Task 7: Agent instructions

**Files:**
- Modify: `server/realtime.ts`

No unit test (prompt text) — verified manually.

- [ ] **Step 1: Extend the INSTRUCTIONS string**

In `server/realtime.ts`, append a paragraph to the `INSTRUCTIONS` template literal, just before the final paragraph that begins "Reference existing objects by their id":

```
You also have eyes: look_at_scene takes a snapshot of the space and tells you what's actually
there. Use it to double-check that a model or image you added matches what the person asked for —
the right model doesn't always load — or when they ask what's in the scene or whether something
looks right. Pass focus with an object id to look closely at one thing. If what you see is wrong,
say so and fix it (try a different spawn_model query, or delete it). Don't overuse it — look when
it genuinely helps, not after every action.
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/realtime.ts
git commit -m "feat(vision): tell the agent it can look_at_scene"
```

---

### Task 8: Full verification + STATUS + deploy + PR

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Run the full suite**

Run: `npm run typecheck && npm test -- --run && npm run build`
Expected: all PASS (new tests green: `framingCamera`, `sceneCapture` bridge, `look_at_scene` handler; build only the known chunk-size warnings).

- [ ] **Step 2: Update STATUS.md**

In `STATUS.md`:
- Under the `/api` routes list (Architecture section), add `POST /api/vision → describe a scene screenshot (vision model)`.
- Under "Agent tools", add `look_at_scene` (capture a snapshot → server vision → description).
- Under "Repo map", add `src/xr/SceneCapture.tsx` + `src/xr/sceneCapture.ts` (capture) and `server/vision.ts`.
- Under "Secrets / environment", add the optional `VISION_MODEL` override (default `gpt-4o-mini`).
- Add a short "Phases completed" entry for agent vision.

- [ ] **Step 3: Commit STATUS**

```bash
git add STATUS.md
git commit -m "docs: STATUS — agent vision (look_at_scene + /api/vision)"
```

- [ ] **Step 4: Deploy**

Run: `./scripts/deploy.sh`
Expected: rsync + remote build + restart + health check OK.

- [ ] **Step 5: Verify in desktop Chrome** at https://armchair-sparkle.exe.xyz/ (start talking) while watching `./scripts/logs.sh -f`:
  - "Spawn a duck." → then "Look at it and tell me what you see." → the **"looking at the scene…"** bubble appears; the agent describes the duck; `[vision]` line shows in the logs.
  - Force a mismatch (ask for something obscure that loads wrong) → "Check that it's really a <X>" → the agent notices the discrepancy.

- [ ] **Step 6: Verify on the Quest** — in immersive VR, ask the agent to look; confirm capture works through the `gl.xr.enabled` toggle path (the agent returns a real description, not a "couldn't capture" error).

- [ ] **Step 7: Push + open PR**

```bash
git push -u origin agent-vision-look-at-scene
gh pr create --title "Agent vision: look_at_scene (capture + server-side vision)" --body "$(cat <<'EOF'
Gives the voice agent on-demand sight. The agent calls `look_at_scene` (optionally focused on an object id); the client renders the scene to an offscreen target (XR-safe), POSTs the JPEG to a new `/api/vision` route (vision model, key server-side), and the returned description comes back as the tool result for the agent to speak. Reuses the status HUD for a "looking…" indicator.

Solves the "wrong model loaded" problem — the agent can now verify what actually appeared.

Spec: docs/superpowers/specs/2026-06-12-agent-vision-look-at-scene-design.md
Plan: docs/superpowers/plans/2026-06-12-agent-vision-look-at-scene.md

- Voice-triggered (you ask the agent to look); no manual button by design.
- `VISION_MODEL` env var (default gpt-4o-mini) overrides the model.
- typecheck clean, unit tests pass, build clean. Capture-in-XR verified on the Quest.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** capture bridge (Task 2), XR-safe capture component (Task 3) + mount (Task 4), object framing (Task 1), `/api/vision` route (Task 5), `look_at_scene` tool/handler with status-HUD reuse + graceful failures (Task 6), agent instructions (Task 7), `VISION_MODEL` env + docs (Task 8).
- **Type consistency:** `CaptureRequest`/`registerCapturer`/`captureScene` (Task 2) are consumed verbatim in Tasks 3 and 6. `framingCamera` signature (Task 1) is consumed in Task 3. `{ description }` is the contract between the route (Task 5) and the handler (Task 6).
- **No placeholders:** every step has concrete code/commands.
- **Risk note:** the one place to watch in-headset is Task 3's `gl.xr.enabled` toggle during `useFrame`. If the Quest shows a black/garbled snapshot or disrupts the XR view, that's the spot to iterate (alternatives: capture only when not presenting, or use a dedicated second WebGLRenderer). Desktop is lower-risk.
```
