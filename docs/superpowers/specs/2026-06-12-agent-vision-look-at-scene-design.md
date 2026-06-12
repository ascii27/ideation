# Agent Vision — `look_at_scene` design

_Design spec — 2026-06-12. Lets the voice agent actually "see" the 3D scene by capturing
a screenshot and describing it, so it can catch problems like the wrong model loading._

## Goal

The agent is voice-only today and has no perception of what the scene actually looks like —
it only knows the text **scene summary** (ids, kinds, positions). When `spawn_model` pulls the
wrong asset, or a texture/image looks off, the agent can't tell. This feature gives the agent
**on-demand sight**: a `look_at_scene` tool that captures the current 3D view (or a framed shot
of a specific object), runs it through a vision model server-side, and returns a short text
**description** the agent can react to and speak about.

### Decisions (from brainstorming)
- **Vision path:** server-side. Capture client-side → `POST /api/vision` → a vision model
  returns a text description → fed back to the voice agent as the tool result. Robust,
  model-agnostic, no WebRTC data-channel size limits, key stays server-side. (The agent "reads"
  the scene, it does not stream raw pixels into the realtime model.)
- **What to capture:** a **focused object** when an object id is given (frame it using its stored
  position + size — directly solves "wrong model loaded"), else the **user's forward view**.
- **Trigger:** the **agent's discretion** via the tool, guided by its instructions (after a
  model/image loads, or when the person asks what's there / if it looks right). No auto-verify.
- **Vision model:** `gpt-4o-mini`, overridable via a `VISION_MODEL` env var (like `IMAGE_MODEL`).
- **Not adopting iwsdk.dev** — it's a full Three.js ECS framework (not React Three Fiber);
  adopting it would mean rewriting the app. We implement the ~100-line capture ourselves in R3F.

## Data flow

```
Agent (voice) ──look_at_scene{focus?, question?}──▶ handleToolCall
   handleToolCall
     ├─ beginActivity('looking at the scene…')          [reuses the PR-B status HUD]
     ├─ captureScene({ focusId: focus })                 [client R3F → JPEG data URL]
     ├─ POST /api/vision { image, question }             [server → vision model]
     │     ◀── { description }
     ├─ endActivity(...)
     └─ returns { ok, description, scene } ──▶ function_call_output ──▶ agent speaks it
```

## Components

### 1. Capture bridge — `src/xr/sceneCapture.ts` (non-React singleton)

Mirrors the existing global patterns (the zustand store; the `/api/log` bridge in
`toolHandlers.ts`). Lets the non-React tool handler trigger a capture that only the R3F tree
can perform.

```ts
export interface CaptureRequest {
  /** Object id to frame; if omitted, capture the user's forward view. */
  focusId?: string
}

type Capturer = (req: CaptureRequest) => Promise<string>

let capturer: Capturer | null = null

/** Registered by <SceneCapture/> on mount; cleared on unmount. */
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

### 2. Capture component — `src/xr/SceneCapture.tsx`

Mounted inside the Canvas (alongside `<Scene/>` in `App.tsx`, within `<XR>`). Registers the
capturer; owns one reusable render target + camera; fulfills requests on the next `useFrame`.

Behavior:
- One `WebGLRenderTarget(512, 512)` and one `PerspectiveCamera(50, 1, 0.05, 200)`, created once
  (and disposed on unmount).
- `captureScene` resolves a queued request inside `useFrame` (a safe render point) — the bridge
  function returns a Promise; the component stores the pending resolver and fulfills it next tick.
- **Camera placement:**
  - *focus mode* (`focusId` set and found in the store): use the pure helper
    `framingCamera(objPos, objSize, headPos)` (see geometry helper below) to get a camera
    position + look-at target that frames the object from the user's side.
  - *forward mode*: `mainCamera.getWorldPosition(pos)` + `getWorldQuaternion(quat)`; copy onto the
    capture camera so it matches the user's gaze.
- **Render + read (XR-safe):**
  ```ts
  const prevXr = gl.xr.enabled
  gl.xr.enabled = false            // Three forces the headset cameras while presenting; disable
  gl.setRenderTarget(target)
  gl.render(scene, captureCam)
  gl.readRenderTargetPixels(target, 0, 0, 512, 512, pixels)  // Uint8Array(512*512*4)
  gl.setRenderTarget(null)
  gl.xr.enabled = prevXr
  ```
  Then blit `pixels` into a 2D `<canvas>` (flipping Y — render-target pixels are bottom-up) and
  `canvas.toDataURL('image/jpeg', 0.8)`.
- Returns the data URL string.

Notes:
- The avatar + status HUD + credits may appear in the shot in v1 (acceptable). A later
  refinement can put UI on a separate `Layer` excluded from the capture camera.
- Using a render target (not `domElement.toDataURL`) avoids needing `preserveDrawingBuffer` and
  works identically on desktop and in immersive XR.

### 3. Object-framing helper — `src/scene/geometry.ts` (pure, unit-tested)

```ts
/** Camera placement to frame an object: returns the camera position and the look-at
 *  target (the object center). The camera sits back from the object toward the viewer
 *  (the head's XZ side), at a height a bit above center, far enough that an object of
 *  the given size roughly fills the frame. Pure — no three types. */
export function framingCamera(
  objPos: [number, number, number],
  objSize: number,
  headPos: [number, number, number],
): { position: [number, number, number]; target: [number, number, number] } {
  const dist = Math.max(0.6, objSize * 2.2) // fit ~the object in a 50° FOV
  // Direction from the object toward the head, on the floor plane (fallback to +z).
  let dx = headPos[0] - objPos[0]
  let dz = headPos[2] - objPos[2]
  const len = Math.hypot(dx, dz) || 1
  dx /= len
  dz /= len
  const center: [number, number, number] = [objPos[0], objPos[1] + objSize * 0.15, objPos[2]]
  return {
    position: [center[0] + dx * dist, center[1] + objSize * 0.4, center[2] + dz * dist],
    target: center,
  }
}
```

### 4. Vision route — `server/vision.ts`

```
POST /api/vision  { image: <data URL>, question?: string }  →  { description: string }
```

- `VISION_MODEL = process.env.VISION_MODEL ?? 'gpt-4o-mini'`.
- Validates `image` is a `data:image/...` URL; rejects otherwise (400).
- Calls OpenAI Chat Completions:
  ```
  POST https://api.openai.com/v1/chat/completions
  { model: VISION_MODEL,
    messages: [{ role: 'user', content: [
      { type: 'text', text: question || DEFAULT_Q },
      { type: 'image_url', image_url: { url: image } } ]}],
    max_tokens: 300 }
  ```
  `DEFAULT_Q = "Briefly describe what's in this image — the main objects, their kind, color, and"
  + " whether anything looks broken, missing, or wrong. 1–3 sentences."`
- Returns `{ description }` from `choices[0].message.content`; 502 on API error. Key from
  `OPENAI_API_KEY`. Structure mirrors `server/image.ts`.
- Mounted in `server/index.ts` next to the other routers.

### 5. Tool — `look_at_scene`

**Schema** (`src/agent/tools.ts`):
```
look_at_scene — Actually look at the space with your own eyes by taking a snapshot and seeing
  what's really there. Use this to check that a model or image you added matches what was asked
  (the right model doesn't always load), or when the person asks what's in the scene or whether
  something looks right. Pass focus with an object id (e.g. "model-1") to look closely at that
  one thing; omit it to look at whatever is in front of the person.
  focus?:    string  object id to inspect up close
  question?: string  what you want to check, e.g. "is this a wooden chair?"
```

**Handler** (`src/agent/toolHandlers.ts`):
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

### 6. Agent instructions (`server/realtime.ts`)

Add a paragraph to `INSTRUCTIONS`:
> You also have eyes: `look_at_scene` takes a snapshot of the space and tells you what's actually
> there. Use it to double-check that a model or image you added matches what the person asked for
> — the right model doesn't always load — or when they ask what's in the scene or whether something
> looks right. Pass `focus` with an object id to look closely at one thing. If what you see is
> wrong, say so and fix it (try a different `spawn_model` query, or delete it). Don't overuse it —
> look when it genuinely helps, not after every action.

## Files

| Path | Change |
|---|---|
| `src/xr/sceneCapture.ts` | **New** — capture singleton bridge (`registerCapturer`/`captureScene`). |
| `src/xr/SceneCapture.tsx` | **New** — R3F component: render-to-target capture, focus/forward modes, XR-safe. |
| `src/scene/geometry.ts` | Add pure `framingCamera` helper. |
| `src/scene/geometry.test.ts` | Tests for `framingCamera`. |
| `server/vision.ts` | **New** — `POST /api/vision` route. |
| `server/index.ts` | Mount `visionRouter`. |
| `src/agent/tools.ts` | Add `look_at_scene` schema. |
| `src/agent/toolHandlers.ts` | Add `look_at_scene` handler (+ import `captureScene`). |
| `src/scene/store.test.ts` | Tests for the `look_at_scene` handler (mock fetch + capturer). |
| `src/App.tsx` | Mount `<SceneCapture/>` inside `<XR>`. |
| `server/realtime.ts` | Extend `INSTRUCTIONS`. |
| `STATUS.md` | Document the tool + route + env var. |

## Testing

- **Unit (vitest):**
  - `framingCamera` — distance scales with size; camera sits on the head's side of the object;
    target is the object center (slightly raised).
  - `look_at_scene` handler — with `registerCapturer` stubbed to return a fake data URL and
    `fetch` mocked to return `{ description }`, the handler returns `{ ok: true, description }`
    and emits begin/end activities; with no capturer registered (`captureScene` → null) it
    returns a clean `{ ok: false }`; unknown `focus` id returns an error without capturing.
- **Manual (deploy + VM):** desktop Chrome — "spawn a duck", then "look at it and tell me what
  you see" → agent describes the duck; "look at the model and check it's really a chair" with a
  wrong load → agent notices. Confirm the status HUD shows "looking at the scene…". Then the
  Quest — confirm capture works in immersive mode (the `gl.xr.enabled` toggle path).

## Error handling

- No capturer / capture throws → `captureScene` returns null → handler returns a friendly
  `{ ok: false }` ("could not capture the scene"); agent can say it couldn't look right now.
- Vision API error / non-image → 4xx/502 from the route → handler `{ ok: false }`.
- All failures still return the scene summary so the agent stays oriented.

## Out of scope (future)

- **Auto-verify on spawn** (chose discretion-only).
- **Excluding the avatar/HUD from the shot** via render layers (v1 may include them; harmless).
- **Streaming raw pixels into the realtime model** (chose server-side text description).
