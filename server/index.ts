import { fileURLToPath } from 'node:url'
import path from 'node:path'
import express from 'express'
import { realtimeRouter } from './realtime.ts'
import { imageRouter } from './image.ts'
import { modelsRouter } from './models.ts'
import { textureRouter } from './texture.ts'
import { logRouter } from './log.ts'
import { visionRouter } from './vision.ts'
import { mcpRouter } from './mcp.ts'
import { hub } from './mcp/hub.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const PORT = Number(process.env.PORT ?? 3000)
const isProd = process.env.NODE_ENV === 'production'

async function main() {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  // Health check — used to confirm the server is up independent of the frontend.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: isProd ? 'production' : 'development' })
  })

  // OpenAI Realtime: browser POSTs its SDP offer to /api/session; the server
  // forwards it (with session config + key) to OpenAI and returns the answer.
  app.use('/api', realtimeRouter)

  // Image panels: generate (gpt-image-1) or fetch-by-URL, returned as a data URL.
  app.use('/api', imageRouter)

  // Vision: describe a screenshot of the 3D scene (look_at_scene tool).
  app.use('/api', visionRouter)

  // Object library: Poly Pizza search + same-origin GLB proxy.
  app.use('/api', modelsRouter)

  // Textures: Poly Haven CC0 PBR diffuse maps as same-origin data URLs.
  app.use('/api', textureRouter)

  // Client→server log bridge (surfaces agent tool calls into journalctl).
  app.use('/api', logRouter)

  // MCP Hub: execute bridged MCP-server tools server-side (Effort B, spec 1).
  app.use('/api', mcpRouter)

  if (isProd) {
    // Serve the built frontend and fall back to index.html for client routing.
    const dist = path.resolve(root, 'dist')
    app.use(express.static(dist))
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  } else {
    // Dev: run Vite in middleware mode so the app + API share one origin with HMR.
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  // Connect configured MCP servers and cache their tools before serving, so the
  // session config can advertise them. Never throws; failures degrade gracefully.
  await hub.connect()

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ideation server listening on http://0.0.0.0:${PORT} (${isProd ? 'prod' : 'dev'})`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
