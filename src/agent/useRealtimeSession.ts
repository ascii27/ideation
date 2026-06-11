import { useCallback, useRef, useState } from 'react'
import { startRealtimeSession, type RealtimeSession, type RealtimeStatus } from './realtime'
import { handleToolCall } from './toolHandlers'

// React wrapper around the Realtime connection. `connect` must be called from a
// user gesture (button tap) so the browser grants mic access and allows audio.
export function useRealtimeSession() {
  const [status, setStatus] = useState<RealtimeStatus>('idle')
  const sessionRef = useRef<RealtimeSession | null>(null)

  const connect = useCallback(async () => {
    if (sessionRef.current) return
    try {
      sessionRef.current = await startRealtimeSession({
        onStatus: setStatus,
        onToolCall: handleToolCall,
      })
    } catch (err) {
      console.error('Realtime connect failed', err)
      setStatus('error')
    }
  }, [])

  const disconnect = useCallback(() => {
    sessionRef.current?.stop()
    sessionRef.current = null
    setStatus('idle')
  }, [])

  return { status, connect, disconnect }
}
