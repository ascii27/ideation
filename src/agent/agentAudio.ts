// Measures the agent's output audio level so the avatar can pulse while it speaks.
// An AnalyserNode taps the remote WebRTC stream (which is also playing through the
// hidden <audio> element). We deliberately do NOT connect the analyser to the
// destination — the <audio> element already handles playback.

let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buffer: Uint8Array<ArrayBuffer> | null = null

export function attachAgentAudio(stream: MediaStream): void {
  detachAgentAudio()
  try {
    audioCtx = new AudioContext()
    void audioCtx.resume()
    const source = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    source.connect(analyser)
  } catch {
    analyser = null
    buffer = null
  }
}

export function detachAgentAudio(): void {
  analyser = null
  buffer = null
  audioCtx?.close().catch(() => {})
  audioCtx = null
}

/** Current output level, roughly 0..1. Returns 0 when nothing is connected. */
export function sampleAgentLevel(): number {
  if (!analyser || !buffer) return 0
  analyser.getByteTimeDomainData(buffer)
  let sum = 0
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 2.5)
}
