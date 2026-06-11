// Browser-side OpenAI Realtime connection over WebRTC.
// We capture the mic, send the SDP offer to our own /api/session route (which
// proxies to OpenAI with the key + session config), and play the model's audio
// reply through a hidden <audio> element — which routes to the headset speakers.

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface RealtimeSession {
  stop: () => void
}

/** A function the model invoked. Return value is serialized back to the model. */
export type ToolCallHandler = (name: string, args: Record<string, unknown>) => unknown

interface FunctionCallItem {
  type: string
  name?: string
  call_id?: string
  arguments?: string
}

export async function startRealtimeSession(opts: {
  onStatus: (s: RealtimeStatus) => void
  onToolCall?: ToolCallHandler
}): Promise<RealtimeSession> {
  const { onStatus, onToolCall } = opts
  onStatus('connecting')

  const pc = new RTCPeerConnection()

  // Remote audio (the agent's voice).
  const audioEl = document.createElement('audio')
  audioEl.autoplay = true
  audioEl.style.display = 'none'
  document.body.appendChild(audioEl)
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0]
  }

  // Microphone input.
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  mic.getTracks().forEach((track) => pc.addTrack(track, mic))

  // Events channel — carries function calls from the model and our results back.
  const dc = pc.createDataChannel('oai-events')
  dc.onopen = () => onStatus('connected')

  const send = (event: unknown) => {
    if (dc.readyState === 'open') dc.send(JSON.stringify(event))
  }

  dc.onmessage = (e) => {
    let event: { type?: string; response?: { output?: FunctionCallItem[] } }
    try {
      event = JSON.parse(e.data)
    } catch {
      return
    }
    // When a response completes, execute any function calls it produced and feed
    // the results back, then ask the model to continue (so it speaks the outcome).
    if (event.type === 'response.done' && onToolCall) {
      const calls = (event.response?.output ?? []).filter((o) => o.type === 'function_call')
      if (calls.length === 0) return
      for (const call of calls) {
        let args: Record<string, unknown> = {}
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {}
        } catch {
          /* leave args empty on malformed JSON */
        }
        let output: unknown
        try {
          output = onToolCall(call.name ?? '', args)
        } catch (err) {
          output = { ok: false, error: String(err) }
        }
        send({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) },
        })
      }
      send({ type: 'response.create' })
    }
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      onStatus('error')
    }
  }

  const cleanup = () => {
    try {
      dc.close()
    } catch {
      /* noop */
    }
    pc.close()
    mic.getTracks().forEach((t) => t.stop())
    audioEl.srcObject = null
    audioEl.remove()
  }

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const resp = await fetch('/api/session', {
      method: 'POST',
      body: offer.sdp,
      headers: { 'Content-Type': 'application/sdp' },
    })
    if (!resp.ok) {
      throw new Error(`/api/session failed: ${resp.status} ${await resp.text()}`)
    }

    const answerSdp = await resp.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  } catch (err) {
    cleanup()
    onStatus('error')
    throw err
  }

  return {
    stop: () => {
      cleanup()
      onStatus('closed')
    },
  }
}
