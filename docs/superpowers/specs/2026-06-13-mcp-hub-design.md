# MCP Hub design

_Design spec — 2026-06-13. Spec 1 of **Effort B (external data integrations)**. Makes the
Express server an MCP host that bridges curated MCP-server tools into the Realtime agent's
tool surface, so the voice agent can call real-world tools and **speak** the result. Weather
(Open-Meteo) is the reference connector._

## Context — where this sits in Effort B

Effort B reframed from "a hand-written fetch route" into **"the Connected Agent"**: MCP servers
and Agent Skills become the agent's primary interface to the world. It decomposes into four
specs, each built in order:

1. **MCP Hub** _(this spec)_ — the server hosts MCP clients and bridges their tools into the
   agent. The "hands." Done = the agent can call a curated MCP tool and speak the result.
2. **Visualization** — a `visualize_data` tool + layout templates that turn a structured result
   into grouped 3D objects. The VR payoff.
3. **Admin Console** — a small web UI (outside VR) to register/enable MCP servers + secrets.
4. **Skills** — injectable per-domain instructions that declare which MCP tools they need and a
   preferred visualization. The "know-how."

Specs 1 + 2 together are the first working vertical slice (one hard-wired weather MCP). This
spec is **1 only**: the agent fetches and *narrates* weather; no visualization yet.

## Goal

The agent's tool surface is hard-coded today (`TOOL_DEFINITIONS` in `src/agent/tools.ts`,
injected server-side into the Realtime session, handled client-side in `toolHandlers.ts`). To
reach live external data we don't want a bespoke `/api/weather` route per domain — we want the
agent to call **MCP tools** from **curated** MCP servers. This spec makes the server an MCP
**host**: at startup it connects to each configured MCP server, lists its tools, and bridges
them into the session as ordinary function tools. When the agent calls one, execution happens
**server-side** (where the MCP connections live) and the result is returned to the model.

Verified in-headset by asking _"what's the weather in Tokyo this week?"_ and hearing an accurate
spoken 7-day answer.

### Decisions (from brainstorming)
- **Data sources stay curated.** The agent only reaches MCP servers an operator wired up — never
  arbitrary endpoints. (Spec 3's admin UI is how operators wire them; this spec hard-wires one.)
- **Server-side host bridge** (not OpenAI-native remote MCP). The Express server is the MCP
  client. Rationale: supports **local stdio** servers, keeps secrets server-side, and routes
  results through our own server so later specs (visualization) can post-process them. Built-in
  tools keep executing **client-side** exactly as today; only bridged MCP tools go server-side.
- **First connector = in-repo stdio MCP server** wrapping Open-Meteo. Self-contained, no API key,
  no third-party uptime/auth dependency, and it exercises the **real** protocol (a separate
  process over stdio) rather than an in-process shortcut. The Hub's client wrapper is
  **transport-agnostic** so HTTP/remote servers slot in later without touching the bridge.
- **Namespaced tool names** (`weather__forecast`) so bridged tools can never collide with
  built-ins, and so the browser can route them generically.
- **Default-case forwarding** in the tool handler: any tool name not handled locally is forwarded
  to `/api/mcp/call`. One path covers every present and future MCP tool — no per-tool wiring.
  Accepted tradeoff: a mistyped built-in name would also be forwarded (and come back as a clean
  "unknown tool" error from the Hub).
- **Hard-wired config file** (`mcp.config.json`) for now; the admin UI (Spec 3) writes the same
  shape later.
- **Reuses the existing status HUD** (`beginActivity`/`endActivity`) for in-flight + error states.

## Data flow

```
Agent (voice) ──weather__forecast{location, days?}──▶ handleToolCall (browser)
   default case (tool not built-in):
     ├─ beginActivity('running weather__forecast…')     [reuses the status HUD; generic label]
     ├─ POST /api/mcp/call { tool, args }                [browser → server]
     │     server: hub.callTool('weather__forecast', args)
     │       └─ stdio JSON-RPC ▶ weather MCP server
     │            └─ Open-Meteo geocode + forecast ▶ normalized JSON
     │     ◀── { result }   (or { error })
     ├─ endActivity(...)
     └─ returns { ok, result } ──▶ function_call_output ──▶ agent speaks it
```

Startup (once): `hub.connect()` spawns each configured server, performs the MCP handshake, and
caches `listTools()`. `server/realtime.ts` appends `hub.getBridgedTools()` to the session's tool
list when building the session config.

## Components

### 1. Weather MCP server — `mcp-servers/weather/index.ts` (standalone stdio process)

A minimal MCP server built on `@modelcontextprotocol/sdk` (server + `StdioServerTransport`). It
is **not** imported by the app; the Hub spawns it as a child process and speaks JSON-RPC over
stdio. Exposes one tool:

```
forecast(location: string, days?: number) → { location, latitude, longitude, days: [...] }
```

Behavior:
- **Geocode** `location` via Open-Meteo's free geocoding API
  (`https://geocoding-api.open-meteo.com/v1/search?name=<location>&count=1`). No key. A miss
  returns an MCP tool error ("couldn't find a place called …").
- **Forecast** via `https://api.open-meteo.com/v1/forecast` with
  `daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`,
  `forecast_days=clamp(days ?? 7, 1, 16)`, `timezone=auto`.
- **Normalize** WMO `weather_code` integers to short condition text (a small lookup table) and
  return compact daily rows: `{ date, hiC, loC, precipPct, condition }`.
- Returns the result as MCP text content containing the JSON (the model reads it).

Pure helpers (WMO-code → condition text; daily-array → rows) live in
`mcp-servers/weather/normalize.ts` and are unit-tested.

### 2. MCP Hub — `server/mcp/hub.ts`

The host singleton. Transport-agnostic over a small internal `McpClient` wrapper (stdio today).

```ts
export interface BridgedTool extends ToolDefinition { /* type:'function', name, description, parameters */ }

export interface McpHub {
  connect(): Promise<void>            // spawn + handshake + listTools for every configured server; cached. Never throws — logs per-server failures and continues.
  getBridgedTools(): BridgedTool[]    // MCP tools mapped to the Realtime function schema, namespaced `${serverId}__${toolName}`
  callTool(name: string, args: Record<string, unknown>): Promise<{ result?: unknown; error?: string }>
  isBridged(name: string): boolean
}
```

- **Mapping (pure, unit-tested) — `server/mcp/bridge.ts`:** `mcpToolToFunction(serverId, mcpTool)`
  → `{ type:'function', name: \`${serverId}__${mcpTool.name}\`, description: mcpTool.description,
  parameters: mcpTool.inputSchema }`. MCP `inputSchema` is already JSON Schema, so it drops
  straight into `parameters`. A reverse `splitName('weather__forecast')` → `{ serverId, toolName }`.
- **callTool:** split the namespaced name → look up the client → `client.callTool(toolName, args)`.
  Unknown name → `{ error: 'unknown tool "…"' }`. Upstream/transport error → `{ error }` (never
  throws to the route).
- **Lifecycle:** `connect()` runs once from `server/index.ts` at boot. Child processes are
  long-lived and reused. A server that fails to start is logged and skipped (the rest of the app
  works); built-in tools are unaffected.

### 3. Config — `server/mcp/config.ts` + `mcp.config.json`

```jsonc
// mcp.config.json (repo root) — hard-wired for Spec 1; the admin UI (Spec 3) writes this later.
{
  "servers": [
    { "id": "weather", "command": "tsx", "args": ["mcp-servers/weather/index.ts"], "env": {} }
  ]
}
```

`loadMcpConfig()` reads + validates the file (shape: `{ servers: {id, command, args?, env?}[] }`),
returns `[]` if absent so the app degrades gracefully. `id` must match `^[a-z][a-z0-9]*$` (it
becomes the tool-name prefix).

### 4. Call route — `server/mcp.ts`

```
POST /api/mcp/call  { tool: string, args?: object }  →  { result }  |  { error }   (4xx/5xx)
```

- Validates `tool` is a non-empty string; `args` defaults to `{}`.
- `hub.callTool(tool, args)`; returns `{ result }` (200) or `{ error }` (400 unknown tool / 502
  upstream). Behind the existing exe.dev private login like every other route. Mounted in
  `server/index.ts` next to the other routers.

### 5. Session wiring — `server/realtime.ts`

When assembling the session config, append the bridged tools and a minimal instruction nudge:

```ts
const tools = [...TOOL_DEFINITIONS, ...hub.getBridgedTools()]
```

Add a short paragraph to `INSTRUCTIONS`:
> You can reach live external data through extra tools when they're available — for example
> `weather__forecast` gives a real multi-day forecast for a place. When the person asks for
> something a tool can answer, call it and tell them what it says. (This minimal glue is what the
> Skills layer generalizes in Spec 4.)

### 6. Browser handler — `src/agent/toolHandlers.ts`

Add a **default case** to `handleToolCall` for any tool name not matched by an existing `case`:

```ts
default: {
  const act = useScene.getState().beginActivity(`running ${name}…`)
  try {
    const resp = await fetch('/api/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, args }),
    })
    const json = (await resp.json()) as { result?: unknown; error?: string }
    if (!resp.ok || json.error) throw new Error(json.error ?? `tool failed (${resp.status})`)
    useScene.getState().endActivity(act, `${name} done`)
    return { ok: true, result: json.result, scene: useScene.getState().summary() }
  } catch (err) {
    useScene.getState().endActivity(act, `${name} failed`, 'error')
    return { ok: false, error: String(err), scene: useScene.getState().summary() }
  }
}
```

The scene summary is still returned so the agent stays oriented (consistent with every other
handler). No client-side knowledge of *which* tools are MCP is needed — anything unhandled is
forwarded, and the Hub is the authority on whether it exists.

## Files

| Path | Change |
|---|---|
| `mcp-servers/weather/index.ts` | **New** — standalone stdio MCP server; `forecast` tool (geocode + Open-Meteo). |
| `mcp-servers/weather/normalize.ts` | **New** — pure WMO-code→text + daily-array→rows helpers. |
| `mcp-servers/weather/normalize.test.ts` | **New** — unit tests for the pure helpers. |
| `server/mcp/hub.ts` | **New** — MCP host singleton (connect/getBridgedTools/callTool/isBridged). |
| `server/mcp/bridge.ts` | **New** — pure `mcpToolToFunction` / `splitName` mapping. |
| `server/mcp/bridge.test.ts` | **New** — unit tests for the mapping + namespacing. |
| `server/mcp/config.ts` | **New** — `loadMcpConfig()` read + validate. |
| `mcp.config.json` | **New** — hard-wired one-server config (weather). |
| `server/mcp.ts` | **New** — `POST /api/mcp/call` route. |
| `server/index.ts` | Mount `mcpRouter`; `await hub.connect()` at boot. |
| `server/realtime.ts` | Append `hub.getBridgedTools()` to the session tools; extend `INSTRUCTIONS`. |
| `src/agent/toolHandlers.ts` | Add the `default` case forwarding to `/api/mcp/call`. |
| `src/agent/toolHandlers.test.ts` (or `store.test.ts`) | Tests for the default case (mock fetch). |
| `package.json` | Add `@modelcontextprotocol/sdk` dependency. |
| `STATUS.md` | Document the MCP Hub, the route, the config file, and the weather connector. |

## Testing

- **Unit (vitest):**
  - `mcpToolToFunction` — namespaces the name (`weather__forecast`), passes `inputSchema` through
    as `parameters`, preserves description; `splitName` round-trips.
  - weather `normalize` — WMO codes map to expected condition text (incl. an unknown code
    fallback); daily arrays zip into `{ date, hiC, loC, precipPct, condition }` rows; `days`
    clamps to 1..16.
  - `toolHandlers` default case — with `fetch` mocked to `{ result }` returns `{ ok: true, result }`
    and emits begin/end activities; with `{ error }` or non-OK returns a clean `{ ok: false }`.
- **Manual (deploy + VM):** desktop Chrome first — "what's the weather in Tokyo this week?" → the
  agent speaks an accurate multi-day forecast; check `./scripts/logs.sh` shows the `weather__forecast`
  call and the `/api/mcp/call` round-trip; confirm the status HUD shows "running weather__forecast…".
  Try a nonsense place ("weather on the moon") → graceful spoken failure. Then the Quest — same
  query by voice in immersive mode.

## Error handling

- **MCP server fails to start** at boot → logged, that server is skipped, `getBridgedTools()` omits
  it; built-in tools and the rest of the app work normally.
- **Geocode miss / upstream failure** in the weather server → MCP tool error → `{ error }` from
  `callTool` → `{ ok: false }` from the handler → HUD error toast → agent apologizes.
- **Unknown / mistyped tool** forwarded to the Hub → `{ error: 'unknown tool' }` (400) → clean
  handler failure (does not crash the session).
- All handler failures still return the scene summary so the agent stays oriented.

## Out of scope (later specs)

- **Visualization** of the data as 3D objects — Spec 2 (`visualize_data` + layout templates).
- **Admin UI** to add/enable servers + secrets — Spec 3 (this spec hard-wires `mcp.config.json`).
- **Skills** (injectable per-domain instructions + preferred visualization) — Spec 4.
- **Additional connectors** beyond weather; **HTTP/remote MCP transport** (client wrapper is built
  transport-agnostic so it can be added without touching the bridge).
- **OpenAI-native remote MCP** (chose the server-side host bridge).
