// Standalone stdio MCP server wrapping Open-Meteo (no API key). The MCP Hub
// (server/mcp/hub.ts) spawns this as a child process and speaks JSON-RPC over
// stdio. NOT imported by the app. Exposes one tool: forecast.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { clampDays, toDailyRows, type DailyRaw } from './normalize.ts'

const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

async function geocode(
  location: string,
): Promise<{ name: string; latitude: number; longitude: number } | null> {
  const r = await fetch(`${GEO}?name=${encodeURIComponent(location)}&count=1&language=en&format=json`)
  if (!r.ok) return null
  const j = (await r.json()) as {
    results?: Array<{ name: string; latitude: number; longitude: number }>
  }
  return j.results?.[0] ?? null
}

const server = new McpServer({ name: 'weather', version: '0.1.0' })

server.tool(
  'forecast',
  'Get a real multi-day weather forecast for a place (city or region name). Returns daily high/low temperatures in °C, chance of precipitation, and a short condition.',
  {
    location: z.string().describe('A place name, e.g. "Tokyo" or "Paris, France".'),
    days: z.number().optional().describe('How many days ahead, 1–16. Default 7.'),
  },
  async ({ location, days }) => {
    const place = await geocode(location)
    if (!place) {
      return { isError: true, content: [{ type: 'text', text: `Couldn't find a place called "${location}".` }] }
    }
    const n = clampDays(days)
    const url =
      `${FORECAST}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&forecast_days=${n}&timezone=auto`
    const r = await fetch(url)
    if (!r.ok) {
      return { isError: true, content: [{ type: 'text', text: `Weather lookup failed (${r.status}).` }] }
    }
    const j = (await r.json()) as { daily?: DailyRaw }
    const rows = j.daily ? toDailyRows(j.daily) : []
    const payload = {
      location: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      days: rows,
    }
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
