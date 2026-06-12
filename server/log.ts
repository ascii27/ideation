import { Router } from 'express'

// POST /api/log — a lightweight bridge so the browser can surface what's
// happening (agent tool calls, failures) into the server's stdout, which is
// captured by journalctl on the VM (`journalctl -u ideation`). This gives a
// single place to watch the session from outside the headset while debugging.
export const logRouter = Router()

logRouter.post('/log', (req, res) => {
  const { event, data } = (req.body ?? {}) as { event?: unknown; data?: unknown }
  const label = typeof event === 'string' ? event : 'event'
  let payload = ''
  try {
    payload = data === undefined ? '' : JSON.stringify(data)
  } catch {
    payload = '[unserializable]'
  }
  // One line per event, prefixed so it's easy to grep.
  console.log(`[client:${label}] ${payload}`)
  res.json({ ok: true })
})
