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
| `src/App.tsx` | Canvas, XR store (teleport pointers), XROrigin, DOM overlay |
| `src/xr/Scene.tsx` | Room, lighting, grid, teleport floor, avatar, credits |
| `src/xr/SceneObjects.tsx` | Renders store objects; grab wrapper; primitives/text/image/model |
| `src/xr/AgentAvatar.tsx` | Glass avatar (state colors, speaking pulse, click → settings) |
| `src/xr/SettingsPanel.tsx`, `VrButton.tsx`, `CreditsPanel.tsx` | In-VR UI |
| `src/agent/tools.ts` | Tool JSON schemas (shared with the server session) |
| `src/agent/toolHandlers.ts` | `handleToolCall` — executes tools against the store |
| `src/agent/realtime.ts`, `useRealtimeSession.ts` | WebRTC connection + React hook |
| `src/agent/agentAudio.ts` | Analyser on the agent's audio → avatar pulse level |
| `src/scene/store.ts`, `types.ts` | Scene store (zustand) + `SceneObject` model |
| `src/scene/modelCatalog.ts` | Curated CC0 GLB catalog (keyword → model) |
| `src/scene/materials.ts` | Material presets → physical material params |
| `src/scene/store.test.ts` | Unit tests (18) for store / handlers / catalog / materials |
| `scripts/deploy.sh`, `deploy/ideation.service` | Deploy + systemd unit |

## Agent tools (what the agent can do)

`spawn_object` (box/sphere/cylinder/cone/torus), `update_object` (color/size/move/rotate),
`delete_object`, `create_text_panel`, `create_image_panel` (generate or URL),
`spawn_model` (curated catalog first, else Poly Pizza search), `apply_texture`
(generate / URL / Poly Haven CC0), `set_material` (metal/glass/plastic/wood/matte +
metalness/roughness/color), `set_physics` (toggle gravity + collision),
`create_ground` (large flat textured ground plane), `list_scene`, `clear_scene`.

User-side (not agent): **teleport** (point a controller at the floor, release) and
**grab/move/rotate** any object (the moved transform is written back to the store so the
agent's memory stays correct).

## Secrets / environment (on the VM, `/home/exedev/ideation/.env`)

- `OPENAI_API_KEY` — Realtime voice + `gpt-image-1`. **Set.**
- `POLY_PIZZA_API_KEY` — Poly Pizza model search. **Set.**
- Poly Haven needs no key. Optional overrides: `REALTIME_MODEL`, `REALTIME_VOICE`,
  `IMAGE_MODEL`, `IMAGE_SIZE`, `PORT` (default 3000; exe.dev proxy points here).
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
- **Physics & positioning** (Effort A) — the grid is now solid **ground at y=0** (fixed Rapier
  collider via `@react-three/rapier`). Solids (primitives + models) are rigid bodies that
  **rest on the floor** with **gravity + collision on by default** — no more buried objects.
  Grab drives a body kinematically and drops/settles on release (transform synced back to the
  store). Toggle by voice via `set_physics` (gravity/collision). Text/image panels stay
  floating (outside physics). The agent **avatar follows the user** at the lower-right of view,
  ~40% smaller (lazy damped follow). Spec + plan in `docs/superpowers/`.

All PRs (#1–#7) are merged. Effort A is on branch `effort-a-positioning-physics` (PR #8).

## Not done yet / next steps

- **Phase 4 — spatial memory & persistence** (the main remaining roadmap item): persist the
  scene so a session resumes where it left off (localStorage and/or server), named references
  ("put the tree where the red box was"), and group/arrange tools. Spatial memory currently
  lives only in-session via the scene summary; nothing is persisted across reloads.
- **Snap-turn** locomotion (thumbstick rotate) was intentionally skipped in 5A; teleport +
  physical turning is all there is for now.
- **Texturing targets primitives only**; loaded GLB models keep their own materials (tinting/
  texturing models is a possible follow-up).
- **Grab** currently allows translate + rotate (scale disabled).

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

## First things to do in a new session

1. Read this file and skim `src/scene/store.ts`, `src/agent/tools.ts`, `src/agent/toolHandlers.ts`.
2. `git status` / `git log --oneline -8` to confirm you're current on `main`.
3. If changing behavior: branch off `main`, build with `npm run typecheck && npm test && npm run build`,
   then `./scripts/deploy.sh` and verify at https://armchair-sparkle.exe.xyz/.
4. Likely next feature: **Phase 4 (spatial memory/persistence)** — see above.
