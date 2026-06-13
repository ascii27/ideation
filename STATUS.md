# Ideation — Project Status & Handoff

_Last updated: 2026-06-12. This file is a handoff so a fresh session can read it and pick up._

## What this is

**Ideation** is a voice-driven **WebXR brainstorming space**. You open it on a Quest
headset, enter VR, and talk to an "ideation companion" — an OpenAI Realtime agent that
hears your voice, talks back, and **takes actions in the 3D space**: spawning and
manipulating objects, pulling in real 3D models, images, and text notes, and texturing
things. The goal is a spatial place to think out loud with an AI collaborator.

## Live deployment

- **URL:** https://armchair-sparkle.exe.xyz/ (open in desktop Chrome or the Quest Browser).
- Hosted on the **exe.dev VM `armchair-sparkle`** as a long-running Node/Express service
  (systemd unit `ideation`). exe.dev provides automatic HTTPS (required for WebXR).
- The VM is **private** — first visit redirects to an exe.dev login (only the owner can
  reach it; this also protects the token/key endpoints). Log into exe.dev once in the Quest
  Browser.
- **There is no local-laptop acceptance testing.** Everything is tested against the exe.xyz
  URL. Deploy, then test there (desktop Chrome first for the voice path, then the Quest for XR).

## How to run / deploy / test

```bash
# from the repo root
npm install
npm run typecheck      # tsc --noEmit
npm test               # vitest (unit tests for the scene store / tools / materials)
npm run build          # vite build -> dist/

./scripts/deploy.sh    # rsync to armchair-sparkle, npm install + build on the VM,
                       # restart the systemd service, health check
./scripts/logs.sh      # fetch the VM service logs (journalctl -u ideation).
                       # e.g. ./scripts/logs.sh 200 texture  | ./scripts/logs.sh -f
```

- The client posts agent tool calls to `/api/log`, which the server prints to
  stdout (captured by journalctl) — so `./scripts/logs.sh` shows what the agent did
  (tool calls, texture lookups/fallbacks, image generations, errors) from outside
  the headset.

- `npm run dev` runs the Express server with Vite in middleware mode (single origin + HMR).
- Deploy is the normal loop: edit locally → `./scripts/deploy.sh` → open the exe.xyz URL.
- To use voice/headset on the Quest: open the URL, tap the floating **glass avatar** →
  **Start talking** (grants mic), then **Enter VR**.

## Architecture

```
Quest Browser ──HTTPS──> https://armchair-sparkle.exe.xyz/  (exe.dev VM, private)
                                   │
   Long-running Node/Express server (server/index.ts)
     ├── serves the frontend (Vite middleware in dev, static dist/ in prod)
     ├── POST /api/session         → SDP-proxy to OpenAI Realtime (key + tools stay server-side)
     ├── POST /api/image           → gpt-image-1 generate OR proxy a URL → data URL
     ├── GET  /api/models/search   → Poly Pizza search (POLY_PIZZA_API_KEY)
     ├── GET  /api/models/proxy    → stream a GLB same-origin
     ├── GET  /api/texture         → Poly Haven CC0 diffuse map → data URL (no key)
     ├── POST /api/log             → client→stdout log bridge (journalctl; see scripts/logs.sh)
     ├── POST /api/vision          → describe a scene screenshot (vision model; look_at_scene)
     ├── POST /api/mcp/call        → execute a bridged MCP-server tool (MCP Hub; Effort B spec 1)
     └── GET  /api/health

   Frontend (React + TS, React Three Fiber + @react-three/xr):
     ├── Scene store (zustand, src/scene/store.ts)  ← single source of truth + agent memory
     ├── Renderers (src/xr/SceneObjects.tsx)        ← store objects → meshes/models/panels
     ├── Realtime client (src/agent/realtime.ts)    ← WebRTC mic in / audio out, tool-call events
     └── Tool handlers (src/agent/toolHandlers.ts)  ← execute agent tools against the store
```

**Core idea:** the agent never touches the renderer directly. It calls **tools** (function
calls over the WebRTC data channel) → handlers mutate the **zustand store** → R3F re-renders.
After each tool call a compact text **summary of the scene** is returned to the model, so it
always knows what exists and where (lightweight spatial memory within a session).

- **Voice:** OpenAI Realtime API (`gpt-realtime-2`, voice `marin`), speech-to-speech over
  WebRTC. The browser POSTs its SDP offer to `/api/session`; the server attaches the session
  config (instructions + tools) and the API key and forwards to OpenAI. The key never reaches
  the browser.

## Repo map (key files)

| Path | Purpose |
|---|---|
| `server/index.ts` | Express app; serves frontend + mounts all `/api` routers |
| `server/realtime.ts` | `/api/session` SDP-proxy; agent **instructions** + tool injection |
| `server/image.ts` | `/api/image` — gpt-image-1 generate / URL proxy |
| `server/models.ts` | `/api/models/search` (Poly Pizza) + `/api/models/proxy` (GLB) |
| `server/texture.ts` | `/api/texture` — Poly Haven CC0 diffuse maps |
| `server/log.ts` | `/api/log` — client→stdout log bridge (agent tool calls, etc.) |
| `src/App.tsx` | Canvas, XR store (teleport pointers), XROrigin, DOM overlay |
| `src/xr/Scene.tsx` | Room, lighting, grid, **`<Physics>` world + ground collider at y=0**, avatar, credits |
| `src/xr/SceneObjects.tsx` | Renders store objects; physics rigid bodies + grab; primitives/text/image/model/**ground** |
| `src/xr/AgentAvatar.tsx` | Glass avatar (state colors, speaking pulse, click → settings); **lazy-follows the user**; mounts the status bubble |
| `src/xr/Locomotion.tsx` | Thumbstick locomotion: left-stick **hop**, right-stick **45° snap-turn** (head-pivot) |
| `src/xr/StatusBubble.tsx` | Floating activity HUD above the avatar (loading/done/error lines, auto-expire) |
| `src/xr/SceneCapture.tsx` | Renders the scene to an offscreen target → JPEG (XR-safe); the agent's "eyes" |
| `src/xr/captureBridge.ts` | Singleton bridge so the tool handler can trigger a capture (`registerCapturer`/`captureScene`) |
| `server/vision.ts` | `/api/vision` — describe a scene screenshot via a vision model (`VISION_MODEL`) |
| `server/mcp.ts` | `/api/mcp/call` — execute a bridged MCP tool server-side |
| `server/mcp/hub.ts` | MCP host: spawn configured MCP servers at boot, bridge their tools into the session, execute calls |
| `server/mcp/bridge.ts` | Pure MCP-tool→function-tool mapping (namespacing + `inputSchema`→`parameters`) |
| `server/mcp/config.ts` | Load/validate `mcp.config.json` (the configured MCP server list) |
| `mcp-servers/weather/` | Standalone stdio MCP server wrapping Open-Meteo (`forecast` tool) + pure `normalize` helpers |
| `src/xr/SettingsPanel.tsx`, `VrButton.tsx`, `CreditsPanel.tsx` | In-VR UI |
| `src/agent/tools.ts` | Tool JSON schemas (shared with the server session) |
| `src/agent/toolHandlers.ts` | `handleToolCall` — executes tools against the store |
| `src/agent/realtime.ts`, `useRealtimeSession.ts` | WebRTC connection + React hook |
| `src/agent/agentAudio.ts` | Analyser on the agent's audio → avatar pulse level |
| `src/scene/store.ts`, `types.ts` | Scene store (zustand) + `SceneObject` model + `physics` state |
| `src/scene/geometry.ts` | Pure helpers: base-on-floor heights, physics collision-group masks |
| `src/scene/modelCatalog.ts` | Curated CC0 GLB catalog (keyword → model) |
| `src/scene/materials.ts` | Material presets → physical material params |
| `src/scene/store.test.ts`, `geometry.test.ts` | Unit tests (34 total) for store / handlers / physics / geometry / materials |
| `scripts/deploy.sh`, `scripts/logs.sh`, `deploy/ideation.service` | Deploy + log fetch + systemd unit |
| `docs/superpowers/specs/`, `plans/` | Effort A design spec + implementation plan |

## Agent tools (what the agent can do)

`spawn_object` (box/sphere/cylinder/cone/torus), `update_object` (color/size/move/rotate +
**`scale` per-axis stretch/squish** + **`glow` light emission**),
`delete_object`, `create_text_panel`, `create_image_panel` (generate or URL),
`spawn_model` (curated catalog first, else Poly Pizza search), `apply_texture`
(generate / URL / Poly Haven CC0), `set_material` (metal/glass/plastic/wood/matte +
metalness/roughness/color), `set_physics` (toggle gravity + collision),
`set_environment` (**sky/background color, ambient light intensity, fog**),
`create_ground` (large flat textured ground plane),
`look_at_scene` (**the agent "sees": snapshot the view or a focused object → vision model → spoken description**),
`list_scene`, `clear_scene`.

**Bridged MCP tools (Effort B, spec 1):** `weather__forecast` — live multi-day weather for a place
(Open-Meteo, no key), exposed by the in-repo stdio weather MCP server and bridged into the agent by the
**MCP Hub**. Any tool the browser doesn't handle locally is forwarded to `/api/mcp/call` and executed
server-side (`toolHandlers.ts` default case), so adding an MCP server gives the agent new tools with zero
client changes. Tools are namespaced `<serverId>__<tool>` to avoid colliding with built-ins.

User-side (not agent): **teleport** (point a controller at the floor, release),
**thumbstick locomotion** (left stick = hop ~1.5 m in the gaze-relative pushed direction;
right stick = 45° snap-turn pivoting around the head), and **grab/move/rotate** any object
(the moved transform is written back to the store so the agent's memory stays correct).

**Movement-loss bug (fixed):** the `create_ground` plane (at y=0.02) used to occlude the base
floor teleport target, silently breaking teleport after ground was laid down. The ground plane
is now itself a `TeleportTarget`, and thumbstick hop is a raycast-independent fallback.

## Secrets / environment (on the VM, `/home/exedev/ideation/.env`)

- `OPENAI_API_KEY` — Realtime voice + `gpt-image-1`. **Set.**
- `POLY_PIZZA_API_KEY` — Poly Pizza model search. **Set.**
- `OPENAI_API_KEY` also powers the vision model behind `/api/vision` (`look_at_scene`).
- Poly Haven needs no key. Optional overrides: `REALTIME_MODEL`, `REALTIME_VOICE`,
  `IMAGE_MODEL`, `IMAGE_SIZE`, `VISION_MODEL` (default `gpt-4o-mini`), `PORT` (default 3000;
  exe.dev proxy points here).
- **MCP servers** are configured in `mcp.config.json` (repo root, `{ servers: [{ id, command, args, env }] }`);
  the bundled **weather** server uses **Open-Meteo** (geocoding + forecast) and needs **no key**. The MCP
  Hub connects to the configured servers at boot (failures are logged and skipped — built-in tools still work).
- The systemd unit loads this `.env`. After changing it: `sudo systemctl restart ideation`.

## Phases completed (all merged to `main`)

- **0** Scaffold + Node server on exe.dev + blank VR room.
- **1** Live voice loop (OpenAI Realtime over WebRTC).
- **2** Agent spawns/manipulates primitives + text panels by voice.
- **3** Image panels (generate via gpt-image-1 or fetch by URL).
- **Avatar** Glass agent avatar = in-VR control surface (start/stop voice, clear).
- **5A** Teleport locomotion + grab-and-move (with transform synced back to the store).
- **5B** Object library — curated CC0 (Khronos sample assets) + Poly Pizza search; GLBs
  auto-normalized (recenter + uniform-scale); in-scene credits for attribution.
- **5C** Texturing & materials — `apply_texture` (generated / URL / Poly Haven CC0 PBR) +
  `set_material` presets.
- **Physics & positioning (Effort A)** — solid **ground at y=0** (fixed Rapier collider via
  `@react-three/rapier`). Solids (primitives + models) are rigid bodies that **rest on the
  floor**, **gravity + collision on by default**; toggle by voice via `set_physics`. Primitives
  use exact analytic colliders (ball/cylinder/cone/cuboid); **models use a stable explicit box
  collider** (NOT auto-hull, which floated them by ~size/2) and collide with the floor only +
  locked rotation so they sit level & upright. Grab drives a body kinematically and drops/settles
  on release; the grab `targetRef` is a static world-space group (a body-nested target broke
  grabbing). Text/image panels stay floating (outside physics). The **avatar lazy-follows the
  user** at the lower-right, ~40% smaller. `apply_texture` now textures **models too** (per-
  instance material clone), with a **Poly Haven→generate fallback**. New **`create_ground`** lays
  a large flat textured ground plane. **Logging**: `/api/log` bridge + `scripts/logs.sh` surface
  agent tool calls / texture / image events to journalctl. Spec + plan in `docs/superpowers/`.

All PRs (#1–#7) are merged. **Effort A = PR #8** (`effort-a-positioning-physics`) — merged.

- **QoL-A — environment & objects** (`qol-environment-objects`): scene-global **`set_environment`**
  tool (sky/background color, ambient-light intensity — raise it when models look dark, fog toggle),
  **object glow** (objects can be light sources: emissive material + a color-matched point light,
  capped at 6 simultaneous glow lights — candle/sun), and **non-uniform transform** (`update_object`
  `scale: [x,y,z]` stretch/squish, with **colliders scaled per-axis** to match; a non-uniformly-scaled
  sphere uses a mean-radius ball collider — no ellipsoid in Rapier). Pure helpers `effectiveScale` /
  `scaledColliderArgs` in `src/scene/geometry.ts`. Design + plan in `docs/superpowers/`.

- **QoL-B — locomotion & status HUD** (`qol-locomotion-status`): **thumbstick locomotion** —
  left-stick **hop** (~1.5 m, gaze-relative, edge-triggered) + right-stick **45° snap-turn**
  (pivots around the head via the pure `pivotPlayerPosition` helper); new `src/xr/Locomotion.tsx`
  inside `<XR>`, with `playerYaw` lifted into `App`. **Teleport-loss fix**: `create_ground` plane
  is now a `TeleportTarget` (it previously occluded the base floor target and broke teleport).
  **Status HUD**: a transient `activities` feed in the store (`beginActivity`/`endActivity`/`toast`),
  emitted by the async + quick tool handlers, rendered by `src/xr/StatusBubble.tsx` above the
  avatar (loading → done/error, auto-expiring). Design + plan in `docs/superpowers/`.

- **Agent vision — `look_at_scene`** (`agent-vision-look-at-scene`): the agent can now **see** the
  space. It calls `look_at_scene` (optionally `focus`ed on an object id); `src/xr/SceneCapture.tsx`
  renders the scene to an offscreen target → JPEG (XR-safe: toggles `gl.xr.enabled` off around the
  render, restored in a `finally`), reachable from the handler via the `src/xr/captureBridge.ts`
  singleton; the JPEG is POSTed to **`/api/vision`** (`server/vision.ts`, `VISION_MODEL` default
  `gpt-4o-mini`, key server-side) and the returned **text description** comes back as the tool result
  for the agent to speak. Solves "the wrong model loaded" — the agent verifies what's actually there.
  Voice-triggered by design (you ask it to look; no manual button). Pure `framingCamera` helper in
  `src/scene/geometry.ts`. Design + plan in `docs/superpowers/`.

## Not done yet / next steps

- **"Basics" polish — DONE** (QoL-A + QoL-B above): sky color, ambient light, object glow,
  non-uniform transform, thumbstick locomotion (hop + snap-turn), teleport-loss fix, and the
  **status HUD** (which closes out the earlier "loading/status indicators for async ops"
  follow-up — ground/texture/model/image generation now shows a bubble above the avatar).
- **Effort B — external data integrations ("The Connected Agent")**: reframed so **MCP servers +
  Agent Skills** are the agent's primary interface to the world (all connectors curated). Decomposed
  into 4 specs: **(1) MCP Hub** — server hosts MCP clients, bridges their tools into the Realtime
  session, executes server-side via `/api/mcp/call`; **(2) Visualization** — `visualize_data` + layout
  templates turning data into grouped 3D objects; **(3) Admin Console** — web UI (outside VR) to
  register/enable MCP servers; **(4) Skills** — injectable per-domain instructions + preferred
  visualization. **Spec 1 (MCP Hub) is DONE** (this branch `effort-b-mcp-hub`): in-repo stdio weather
  server (Open-Meteo) → agent calls `weather__forecast` and *speaks* the forecast. Specs 2–4 remain;
  next is Spec 2 (visualization). Spec + plan in `docs/superpowers/`.
- **Phase 4 — spatial memory & persistence**: persist the scene across reloads (localStorage and/or
  server), named references ("put the tree where the red box was"), group/arrange tools.
- **Locomotion** now offers teleport, physical turning, **thumbstick hop**, and **45° snap-turn**
  (QoL-B). Tuning constants (hop distance, turn angle, stick thresholds) live at the top of
  `src/xr/Locomotion.tsx`; if hop/turn feels reversed in-headset, flip the signs there.
- **Grab** allows translate + rotate (scale disabled); the agent can non-uniformly scale via
  `update_object` `scale`.
- **Known minor**: the ground surface sits ~2 cm above y=0, so solids rest a hair into it
  (intentional, looks natural); primitives currently pass through models (models are floor-only).

## Conventions & gotchas

- **One branch + PR per phase** (e.g. `phase-5c-texturing`), based on `main`; merge in order.
  PRs were sometimes stacked when a prior PR wasn't merged yet.
- **Deploy-and-test on the VM** — no local acceptance testing (WebXR needs HTTPS; the VM
  provides it).
- **WebXR requires HTTPS** — exe.dev gives it for free; that's why there's no tunnel.
- **Same-origin data URLs** for images/textures avoid WebGL CORS tainting; GLBs are proxied
  for the same reason.
- The server runs TypeScript directly via `tsx` (no separate server build). Server files use
  `.ts` import specifiers (e.g. `import { x } from './foo.ts'`).
- `tsx` runs server code; `vite` builds the client. `npm run typecheck` covers both.
- Build emits large-chunk warnings (three.js / drei) — expected, not a problem.
- Provider note: voice + images are **OpenAI**; models = **Poly Pizza** (CC0 + CC-BY) and
  **Khronos sample assets**; textures = **Poly Haven** (CC0). Respect CC-BY attribution
  (surfaced via the in-scene Credits panel).
- **Physics (`@react-three/rapier` v1 — pinned for R3F v8; v2 needs R3F v9).** `isSolidKind`
  (`src/scene/geometry.ts`) decides what's a physics body (primitives + models, NOT text/image/
  ground). Models: explicit box collider sized from `size`, floor-only collision, locked rotation
  — do **not** revert to `colliders="hull"` (it builds from the centered loading placeholder and
  ejects the body upward by ~size/2). Grab `targetRef` must stay a static world-space group, not a
  body-nested one. `set_physics` toggles live via the `<Physics gravity>` prop + per-body
  `collisionGroups`.

## First things to do in a new session

1. Read this file and skim `src/scene/store.ts`, `src/agent/tools.ts`, `src/agent/toolHandlers.ts`,
   `src/xr/SceneObjects.tsx` (physics/grab/ground), `src/scene/geometry.ts`.
2. `git status` / `git log --oneline -8` to confirm you're current on `main` (Effort A / PR #8 merged).
3. If changing behavior: branch off `main`, build with `npm run typecheck && npm test && npm run build`,
   then `./scripts/deploy.sh` and verify at https://armchair-sparkle.exe.xyz/. Use `./scripts/logs.sh`
   to watch what the agent actually did on the server while testing.
4. **Next up: a few more "basics" polish fixes** (ask the user what's on the list), likely including
   loading/status indicators. Then **Effort B (external data integrations)**. Phase 4 (persistence)
   remains the larger roadmap item.
