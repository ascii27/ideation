import express, { Router } from 'express'
import { TOOL_DEFINITIONS } from '../src/agent/tools.ts'

// OpenAI Realtime session config. The browser sends us its SDP offer; we attach
// the session configuration + API key server-side and forward to OpenAI, then
// return the SDP answer. The key never reaches the client.
const MODEL = process.env.REALTIME_MODEL ?? 'gpt-realtime-2'
const VOICE = process.env.REALTIME_VOICE ?? 'marin'

const INSTRUCTIONS = `You are an ideation companion in a voice-first VR brainstorming space.
The person is thinking out loud and wants a warm, curious collaborator — not an assistant taking orders.
Keep replies short and conversational, like a real back-and-forth. Ask sharp questions, build on ideas,
offer unexpected angles, and leave room for the person to talk. Avoid long monologues and avoid lists
unless asked. Speak naturally.

You can shape the space around you with tools: create, modify, move, and delete 3D objects, and place
floating text panels to capture ideas. Use them whenever it helps make thinking visible — sketch a
concept as objects, jot an idea on a panel, rearrange things as the conversation evolves. Reference
existing objects by their id (like "box-1") from the scene summary returned after each action. Don't
read coordinates or ids aloud; just briefly say what you did in natural language.`

export const realtimeRouter = Router()

// Raw SDP comes in as text/plain or application/sdp.
realtimeRouter.post(
  '/session',
  express.text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }),
  async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server' })
      return
    }

    const sessionConfig = JSON.stringify({
      type: 'realtime',
      model: MODEL,
      instructions: INSTRUCTIONS,
      audio: { output: { voice: VOICE } },
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    })

    const fd = new FormData()
    fd.set('sdp', typeof req.body === 'string' ? req.body : '')
    fd.set('session', sessionConfig)

    try {
      const r = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      })
      const sdp = await r.text()
      if (!r.ok) {
        console.error('OpenAI Realtime calls error', r.status, sdp)
        res.status(502).type('text/plain').send(sdp)
        return
      }
      res.type('application/sdp').send(sdp)
    } catch (err) {
      console.error('Realtime session error', err)
      res.status(500).json({ error: 'Failed to establish realtime session' })
    }
  },
)
