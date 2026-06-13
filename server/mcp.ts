import { Router } from 'express'
import { hub } from './mcp/hub.ts'

// Executes a bridged MCP tool server-side. The browser tool handler forwards
// any tool it doesn't handle locally here. Behind the exe.dev private login.
export const mcpRouter = Router()

mcpRouter.post('/mcp/call', async (req, res) => {
  const body = (req.body ?? {}) as { tool?: unknown; args?: unknown }
  const tool = typeof body.tool === 'string' ? body.tool : ''
  if (!tool) {
    res.status(400).json({ error: 'missing tool' })
    return
  }
  if (!hub.isBridged(tool)) {
    res.status(400).json({ error: `unknown tool "${tool}"` })
    return
  }
  const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {}
  const out = await hub.callTool(tool, args)
  if (out.error) {
    res.status(502).json({ error: out.error })
    return
  }
  res.json({ result: out.result })
})
