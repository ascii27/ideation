import type { ToolDefinition } from '../../src/agent/tools.ts'

// Minimal shape of an MCP tool as returned by client.listTools().
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export function namespacedName(serverId: string, toolName: string): string {
  return `${serverId}__${toolName}`
}

// Inverse of namespacedName. Returns null if `name` is not `<serverId>__<toolName>`
// (e.g. a built-in tool name, or a malformed one with an empty serverId).
export function splitName(name: string): { serverId: string; toolName: string } | null {
  const i = name.indexOf('__')
  if (i <= 0 || i + 2 >= name.length) return null
  return { serverId: name.slice(0, i), toolName: name.slice(i + 2) }
}

// MCP inputSchema is already JSON Schema, so it drops straight into the
// Realtime function tool's `parameters`.
export function mcpToolToFunction(serverId: string, tool: McpToolInfo): ToolDefinition {
  return {
    type: 'function',
    name: namespacedName(serverId, tool.name),
    description: tool.description ?? '',
    parameters: tool.inputSchema ?? { type: 'object', properties: {} },
  }
}
