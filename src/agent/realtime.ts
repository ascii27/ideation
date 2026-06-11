// Browser-side OpenAI Realtime connection over WebRTC.
// We capture the mic, send the SDP offer to our own /api/session route (which
// proxies to OpenAI with the key + session config), and play the model's audio
// reply through a hidden <audio> element — which routes to the headset speakers.

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface RealtimeSession {
  stop: () => void
}

export async function startRealtimeSession(opts: {
  onStatus: (s: RealtimeStatus) => void
}): Promise<RealtimeSession> {
  const { onStatus } = opts
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

  // Events channel (used in later phases for tool calls / transcripts).
  const dc = pc.createDataChannel('oai-events')
  dc.onopen = () => onStatus('connected')

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
