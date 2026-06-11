import { Router } from 'express'

// Poly Haven CC0 PBR textures. GET /api/texture?q=<material> finds the best
// matching texture asset, fetches its 1k diffuse map, and returns it as a
// same-origin data URL (so it can be used as a WebGL texture without CORS taint).
export const textureRouter = Router()

const MAX_BYTES = 12 * 1024 * 1024
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface AssetMeta {
  name?: string
  tags?: string[]
  categories?: string[]
}

let assetCache: Record<string, AssetMeta> | null = null
let assetCacheAt = 0

async function getAssets(): Promise<Record<string, AssetMeta>> {
  const now = Date.now()
  if (assetCache && now - assetCacheAt < CACHE_TTL_MS) return assetCache
  const r = await fetch('https://api.polyhaven.com/assets?type=textures')
  if (!r.ok) throw new Error(`asset list failed (${r.status})`)
  assetCache = (await r.json()) as Record<string, AssetMeta>
  assetCacheAt = now
  return assetCache
}

function pickSlug(assets: Record<string, AssetMeta>, query: string): string | null {
  const q = query.toLowerCase().trim()
  const tokens = q.split(/\s+/).filter(Boolean)
  let best: string | null = null
  let bestScore = 0
  for (const [slug, meta] of Object.entries(assets)) {
    const hay = `${slug} ${meta.name ?? ''} ${(meta.tags ?? []).join(' ')} ${(meta.categories ?? []).join(' ')}`.toLowerCase()
    let score = 0
    for (const t of tokens) if (hay.includes(t)) score++
    if (hay.includes(q)) score += 2
    if (score > bestScore) {
      bestScore = score
      best = slug
    }
  }
  return bestScore > 0 ? best : null
}

textureRouter.get('/texture', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.status(400).json({ error: 'missing q' })
    return
  }
  try {
    const assets = await getAssets()
    const slug = pickSlug(assets, q)
    if (!slug) {
      res.status(404).json({ error: `no texture found for "${q}"` })
      return
    }
    const fr = await fetch(`https://api.polyhaven.com/files/${slug}`)
    if (!fr.ok) {
      res.status(502).json({ error: 'texture files lookup failed' })
      return
    }
    const files = (await fr.json()) as {
      Diffuse?: Record<string, { jpg?: { url?: string }; png?: { url?: string } }>
    }
    const diffuse = files.Diffuse?.['1k']
    const url = diffuse?.jpg?.url ?? diffuse?.png?.url
    if (!url) {
      res.status(404).json({ error: 'no diffuse map available' })
      return
    }
    const ir = await fetch(url)
    if (!ir.ok) {
      res.status(502).json({ error: 'map fetch failed' })
      return
    }
    const buf = Buffer.from(await ir.arrayBuffer())
    if (buf.length > MAX_BYTES) {
      res.status(413).json({ error: 'texture too large' })
      return
    }
    const contentType = ir.headers.get('content-type') ?? 'image/jpeg'
    res.json({
      dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
      slug,
      attribution: { author: 'Poly Haven', license: 'CC0', url: `https://polyhaven.com/a/${slug}` },
    })
  } catch (err) {
    console.error('texture error', err)
    res.status(500).json({ error: 'texture request failed' })
  }
})
