import { Router } from 'express'

// POST /api/vision — describe an image with a vision model. The browser captures a
// screenshot of the 3D scene and posts it here; we ask the model a question about it
// and return { description }. The OpenAI key stays server-side. Mirrors image.ts.
export const visionRouter = Router()

const VISION_MODEL = process.env.VISION_MODEL ?? 'gpt-4o-mini'
const DEFAULT_Q =
  "Briefly describe what's in this image — the main objects, their kind, color, and whether anything looks broken, missing, or wrong. 1–3 sentences."

visionRouter.post('/vision', async (req, res) => {
  const { image, question } = (req.body ?? {}) as { image?: unknown; question?: unknown }
  if (typeof image !== 'string' || !/^data:image\//.test(image)) {
    res.status(400).json({ error: 'Provide an "image" data URL.' })
    return
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' })
    return
  }
  const q = typeof question === 'string' && question ? question : DEFAULT_Q
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: q },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        max_tokens: 300,
      }),
    })
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    if (!r.ok) {
      console.error('Vision error', json)
      res.status(502).json({ error: json?.error?.message ?? 'Vision request failed' })
      return
    }
    const description = json?.choices?.[0]?.message?.content?.trim()
    if (!description) {
      res.status(502).json({ error: 'No description returned' })
      return
    }
    console.log(`[vision] ${description.slice(0, 80)}`)
    res.json({ description })
  } catch (err) {
    console.error('Vision request error', err)
    res.status(500).json({ error: 'Vision request failed' })
  }
})
