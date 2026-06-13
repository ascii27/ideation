import { describe, expect, it } from 'vitest'
import { mcpToolToFunction, namespacedName, splitName } from './bridge'

describe('mcp bridge', () => {
  it('namespaces tool names with the server id', () => {
    expect(namespacedName('weather', 'forecast')).toBe('weather__forecast')
  })

  it('splits a namespaced name back into parts', () => {
    expect(splitName('weather__forecast')).toEqual({ serverId: 'weather', toolName: 'forecast' })
  })

  it('returns null for names that are not namespaced', () => {
    expect(splitName('forecast')).toBeNull()
    expect(splitName('__forecast')).toBeNull()
  })

  it('maps an MCP tool to a Realtime function tool, passing inputSchema through as parameters', () => {
    const schema = { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] }
    const fn = mcpToolToFunction('weather', { name: 'forecast', description: 'gets weather', inputSchema: schema })
    expect(fn).toEqual({
      type: 'function',
      name: 'weather__forecast',
      description: 'gets weather',
      parameters: schema,
    })
  })
})
