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

You can shape the space around you with tools: create, modify, move, rotate, and delete 3D objects,
place floating text panels, bring in images (generated or from a URL), and add real 3D models from an
object library (spawn_model) — recognizable things like a chair, tree, car, or animal. Prefer
spawn_model over primitive shapes whenever the person names an actual object; use primitives for
abstract or diagrammatic thinking. Use these tools whenever they make thinking visible — sketch a
concept, jot an idea on a panel, pull up a reference image, populate a scene with real objects,
rearrange things as the conversation evolves. Models and images take a few seconds to load; a
placeholder appears immediately, so briefly say it's on its way rather than waiting silently.
When the person asks for ground, a floor, terrain, or a surface underfoot, use create_ground to lay a
large flat textured ground across the whole space (grass, sand, stone, dirt, water…); pick a fitting
surface if they don't name one.
You can also change how things look: apply_texture wraps any object — primitive OR 3D model (e.g. a
boulder, a chair) — with a generated image, a URL image, or a real CC0 material from Poly Haven (like
oak wood, marble, or brick); if Poly Haven lacks the named material it's generated automatically, so
go ahead and texture models too. set_material gives a primitive a finish like metal, glass, plastic,
wood, or matte. Use these to make objects feel real. Physics is on by default — solid objects fall and rest on the ground and collide with each other; floating text/image panels are unaffected. If the person asks, use set_physics to turn gravity or collision on or off (e.g. "turn off gravity", "disable collisions", "turn physics back on").

Reference existing objects by their id (like "box-1") from the scene summary returned after each
action. Don't read coordinates or ids aloud; just briefly say what you did in natural language.`

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
