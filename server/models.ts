import { Router } from 'express'

// Object library: search Poly Pizza for GLB models and proxy GLB bytes
// same-origin (so the WebGL loader isn't blocked by CORS). The curated catalog
// (src/scene/modelCatalog.ts) is handled entirely client-side; this router is
// the live-search long tail.
export const modelsRouter = Router()

const POLY_BASE = 'https://api.poly.pizza/v1.1'
const MAX_BYTES = 25 * 1024 * 1024

// Defensive normalization — Poly Pizza field casing has shifted across versions.
function normalize(m: Record<string, unknown>) {
  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) if (typeof m[k] === 'string') return m[k] as string
    return undefined
  }
  const glb = str('Download', 'download', 'glb')
  if (!glb) return null
  const creator = m.Creator as { Username?: string } | undefined
  const author = creator?.Username ?? str('Attribution', 'author') ?? 'Unknown'
  const license = str('licence', 'License', 'license') ?? 'CC-BY'
  const title = str('Title', 'title') ?? 'model'
  return { title, glb, author, license }
}

modelsRouter.get('/models/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.status(400).json({ error: 'missing q' })
    return
  }
  const key = process.env.POLY_PIZZA_API_KEY
  if (!key) {
    res.status(500).json({ error: 'POLY_PIZZA_API_KEY is not set on the server' })
    return
  }
  try {
    const r = await fetch(`${POLY_BASE}/search/${encodeURIComponent(q)}?Limit=12`, {
      headers: { 'x-auth-token': key },
    })
    const json = (await r.json()) as { results?: unknown[]; Results?: unknown[] }
    if (!r.ok) {
      console.error('Poly Pizza search error', json)
      res.status(502).json({ error: 'model search failed' })
      return
    }
    const raw = (json.results ?? json.Results ?? []) as Array<Record<string, unknown>>
    const results = raw.map(normalize).filter((m): m is NonNullable<typeof m> => m != null)
    res.json({ results })
  } catch (err) {
    console.error('model search error', err)
    res.status(500).json({ error: 'model search failed' })
  }
})

modelsRouter.get('/models/proxy', async (req, res) => {
  const url = String(req.query.url ?? '')
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'bad url' })
    return
  }
  try {
    const r = await fetch(url)
    if (!r.ok) {
      res.status(502).json({ error: `fetch failed (${r.status})` })
      return
    }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_BYTES) {
      res.status(413).json({ error: 'model too large' })
      return
    }
    res.setHeader('Content-Type', r.headers.get('content-type') ?? 'model/gltf-binary')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(buf)
  } catch (err) {
    console.error('model proxy error', err)
    res.status(500).json({ error: 'model proxy failed' })
  }
})
