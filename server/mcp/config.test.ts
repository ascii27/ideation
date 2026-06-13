import { describe, expect, it } from 'vitest'
import { parseMcpConfig } from './config'

describe('mcp config parsing', () => {
  it('parses valid server entries', () => {
    const out = parseMcpConfig(
      JSON.stringify({ servers: [{ id: 'weather', command: 'npx', args: ['tsx', 'x.ts'] }] }),
    )
    expect(out).toEqual([{ id: 'weather', command: 'npx', args: ['tsx', 'x.ts'], env: {} }])
  })

  it('drops entries with an invalid id or missing command', () => {
    const out = parseMcpConfig(
      JSON.stringify({ servers: [{ id: 'Bad Id', command: 'x' }, { id: 'noCommand' }] }),
    )
    expect(out).toEqual([])
  })

  it('returns [] when servers is missing or input is not an object', () => {
    expect(parseMcpConfig('{}')).toEqual([])
    expect(parseMcpConfig('null')).toEqual([])
  })
})
