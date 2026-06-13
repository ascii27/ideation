// Pure helpers for the weather MCP server. No I/O — unit-tested.

export interface DailyRaw {
  time?: string[]
  temperature_2m_max?: number[]
  temperature_2m_min?: number[]
  precipitation_probability_max?: Array<number | null>
  weather_code?: number[]
}

export interface DailyRow {
  date: string
  hiC: number | null
  loC: number | null
  precipPct: number | null
  condition: string
}

// WMO weather interpretation codes → short human text (Open-Meteo `weather_code`).
const WMO: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
}

export function wmoCondition(code: number | undefined): string {
  if (code == null) return 'unknown'
  return WMO[code] ?? 'unknown'
}

export function clampDays(days: number | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return 7
  return Math.min(16, Math.max(1, Math.round(days)))
}

export function toDailyRows(d: DailyRaw): DailyRow[] {
  const dates = d.time ?? []
  return dates.map((date, i) => ({
    date,
    hiC: d.temperature_2m_max?.[i] ?? null,
    loC: d.temperature_2m_min?.[i] ?? null,
    precipPct: d.precipitation_probability_max?.[i] ?? null,
    condition: wmoCondition(d.weather_code?.[i]),
  }))
}
