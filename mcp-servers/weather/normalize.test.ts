import { describe, expect, it } from 'vitest'
import { wmoCondition, clampDays, toDailyRows } from './normalize'

describe('weather normalize', () => {
  it('maps known WMO codes and falls back to "unknown"', () => {
    expect(wmoCondition(0)).toBe('clear sky')
    expect(wmoCondition(61)).toBe('light rain')
    expect(wmoCondition(12345)).toBe('unknown')
    expect(wmoCondition(undefined)).toBe('unknown')
  })

  it('clamps days to 1..16 with a default of 7', () => {
    expect(clampDays(undefined)).toBe(7)
    expect(clampDays(0)).toBe(1)
    expect(clampDays(100)).toBe(16)
    expect(clampDays(3)).toBe(3)
  })

  it('zips daily arrays into rows', () => {
    const rows = toDailyRows({
      time: ['2026-06-13', '2026-06-14'],
      temperature_2m_max: [24, 26],
      temperature_2m_min: [18, 19],
      precipitation_probability_max: [10, null],
      weather_code: [2, 95],
    })
    expect(rows).toEqual([
      { date: '2026-06-13', hiC: 24, loC: 18, precipPct: 10, condition: 'partly cloudy' },
      { date: '2026-06-14', hiC: 26, loC: 19, precipPct: null, condition: 'thunderstorm' },
    ])
  })
})
