import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { loadMcpConfig, type McpServerConfig } from './config.ts'
import { mcpToolToFunction, splitName, type McpToolInfo } from './bridge.ts'
import type { ToolDefinition } from '../../src/agent/tools.ts'

interface Connected {
  id: string
  client: Client
  tools: McpToolInfo[]
}

// Child processes don't inherit the parent env unless we pass it. Filter out
// undefined values (process.env values are string | undefined) and overlay the
// per-server env so the child can find `npx`/`tsx` on PATH.
function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') base[k] = v
  return { ...base, ...extra }
}

// MCP tool results are an array of content blocks; join the text parts.
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (c): c is { type: string; text: string } =>
        !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' &&
        typeof (c as { text?: unknown }).text === 'string',
    )
    .map((c) => c.text)
    .join('\n')
}

class McpHub {
  private servers: Connected[] = []
  private connected = false

  // Spawn + handshake + listTools for every configured server. Never throws —
  // a server that fails to start is logged and skipped so the app still runs.
  async connect(configs: McpServerConfig[] = loadMcpConfig()): Promise<void> {
    if (this.connected) return
    this.connected = true
    for (const cfg of configs) {
      try {
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: cleanEnv(cfg.env),
        })
        const client = new Client({ name: 'ideation-hub', version: '0.1.0' }, { capabilities: {} })
        await client.connect(transport)
        const listed = (await client.listTools()) as { tools: McpToolInfo[] }
        this.servers.push({ id: cfg.id, client, tools: listed.tools })
        console.log(`[mcp] connected "${cfg.id}" — tools: ${listed.tools.map((t) => t.name).join(', ')}`)
      } catch (err) {
        console.error(`[mcp] failed to connect "${cfg.id}":`, err)
      }
    }
  }

  getBridgedTools(): ToolDefinition[] {
    return this.servers.flatMap((s) => s.tools.map((t) => mcpToolToFunction(s.id, t)))
  }

  isBridged(name: string): boolean {
    const split = splitName(name)
    if (!split) return false
    const s = this.servers.find((x) => x.id === split.serverId)
    return !!s && s.tools.some((t) => t.name === split.toolName)
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result?: unknown; error?: string }> {
    const split = splitName(name)
    const server = split && this.servers.find((s) => s.id === split.serverId)
    if (!split || !server) return { error: `unknown tool "${name}"` }
    try {
      const res = (await server.client.callTool({ name: split.toolName, arguments: args })) as {
        content?: unknown
        isError?: boolean
      }
      const text = textOf(res.content)
      if (res.isError) return { error: text || 'tool error' }
      return { result: text }
    } catch (err) {
      return { error: String(err) }
    }
  }
}

// Singleton — connected once at server boot (server/index.ts).
export const hub = new McpHub()
