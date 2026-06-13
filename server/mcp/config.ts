import { readFileSync } from 'node:fs'

export interface McpServerConfig {
  id: string
  command: string
  args: string[]
  env: Record<string, string>
}

// id becomes the tool-name prefix (weather__forecast), so keep it simple.
const ID_RE = /^[a-z][a-z0-9]*$/

// Pure: validate a JSON string into a clean server list. Invalid entries are
// dropped, not thrown. Returns [] on any structural problem.
export function parseMcpConfig(raw: string): McpServerConfig[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []
  const servers = (data as { servers?: unknown }).servers
  if (!Array.isArray(servers)) return []
  const out: McpServerConfig[] = []
  for (const s of servers) {
    if (!s || typeof s !== 'object') continue
    const { id, command, args, env } = s as Record<string, unknown>
    if (typeof id !== 'string' || !ID_RE.test(id)) continue
    if (typeof command !== 'string' || command.length === 0) continue
    out.push({
      id,
      command,
      args: Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : [],
      env: env && typeof env === 'object' ? (env as Record<string, string>) : {},
    })
  }
  return out
}

// Reads + parses the config file. Missing/unreadable file → [] (the app still
// runs with only built-in tools). The admin UI (Spec 3) will write this file.
export function loadMcpConfig(file = 'mcp.config.json'): McpServerConfig[] {
  try {
    return parseMcpConfig(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}
