import { Router } from 'express'

// POST /api/image — returns { dataUrl } for an image, either generated from a
// text prompt (OpenAI gpt-image-1) or fetched from a direct URL. Returning a
// data URL keeps the image same-origin so it can be used as a WebGL texture
// without CORS tainting.
export const imageRouter = Router()

const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-1'
const IMAGE_SIZE = process.env.IMAGE_SIZE ?? '1024x1024'
const MAX_BYTES = 12 * 1024 * 1024

imageRouter.post('/image', async (req, res) => {
  const { prompt, url } = (req.body ?? {}) as { prompt?: unknown; url?: unknown }

  try {
    // Bring in a real reference image from a direct URL (proxied through us).
    if (typeof url === 'string' && url) {
      if (!/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: 'Only http(s) URLs are allowed' })
        return
      }
      const r = await fetch(url)
      if (!r.ok) {
        res.status(400).json({ error: `Could not fetch image (${r.status})` })
        return
      }
      const contentType = r.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        res.status(400).json({ error: 'URL is not an image' })
        return
      }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX_BYTES) {
        res.status(413).json({ error: 'Image too large' })
        return
      }
      res.json({ dataUrl: `data:${contentType};base64,${buf.toString('base64')}` })
      return
    }

    // Generate an image from a text prompt.
    if (typeof prompt === 'string' && prompt) {
      console.log(`[image] generate prompt="${prompt.slice(0, 80)}"`)
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' })
        return
      }
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: IMAGE_SIZE }),
      })
      const json = (await r.json()) as {
        data?: Array<{ b64_json?: string }>
        error?: { message?: string }
      }
      if (!r.ok) {
        console.error('Image generation error', json)
        res.status(502).json({ error: json?.error?.message ?? 'Image generation failed' })
        return
      }
      const b64 = json?.data?.[0]?.b64_json
      if (!b64) {
        res.status(502).json({ error: 'No image returned' })
        return
      }
      res.json({ dataUrl: `data:image/png;base64,${b64}` })
      return
    }

    res.status(400).json({ error: 'Provide a "prompt" to generate or a "url" to fetch' })
  } catch (err) {
    console.error('Image request error', err)
    res.status(500).json({ error: 'Image request failed' })
  }
})
