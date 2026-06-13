import { describe, expect, it } from 'vitest'
import { hub } from './hub'

// Unit-level: the routing/error logic with no servers connected. The real
// spawn + Open-Meteo round-trip is verified manually in Step 5 and on the VM.
describe('mcp hub (no connections)', () => {
  it('exposes no bridged tools before connecting', () => {
    expect(hub.getBridgedTools()).toEqual([])
  })

  it('isBridged is false when nothing is connected', () => {
    expect(hub.isBridged('weather__forecast')).toBe(false)
  })

  it('callTool errors cleanly for unknown / malformed names', async () => {
    expect(await hub.callTool('weather__forecast', {})).toEqual({ error: 'unknown tool "weather__forecast"' })
    expect(await hub.callTool('nodash', {})).toEqual({ error: 'unknown tool "nodash"' })
  })
})
