import { fileURLToPath } from 'node:url'
import path from 'node:path'
import express from 'express'

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

  // Phase 1 will mount /api/session here for OpenAI Realtime token minting.

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ideation server listening on http://0.0.0.0:${PORT} (${isProd ? 'prod' : 'dev'})`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
