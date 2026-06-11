import type { CSSProperties } from 'react'
import { Canvas } from '@react-three/fiber'
import { createXRStore, XR } from '@react-three/xr'
import { Scene } from './xr/Scene'
import { useRealtimeSession } from './agent/useRealtimeSession'
import type { RealtimeStatus } from './agent/realtime'

// A single XR store drives the session. The "Enter VR" button lives in normal
// DOM (the headset browser shows it before you enter immersive mode); the Canvas
// renders the same scene flat on desktop and immersively in the headset.
const xrStore = createXRStore()

export function App() {
  const { status, connect, disconnect } = useRealtimeSession()

  return (
    <>
      <Overlay
        status={status}
        onEnter={() => xrStore.enterVR()}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      <Canvas camera={{ position: [0, 1.6, 2.5], fov: 70 }}>
        <XR store={xrStore}>
          <Scene status={status} />
        </XR>
      </Canvas>
    </>
  )
}

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Listening',
  error: 'Error',
  closed: 'Ended',
}

function Overlay({
  status,
  onEnter,
  onConnect,
  onDisconnect,
}: {
  status: RealtimeStatus
  onEnter: () => void
  onConnect: () => void
  onDisconnect: () => void
}) {
  const talking = status === 'connected' || status === 'connecting'
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px',
        color: '#e8e8f0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ pointerEvents: 'auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', letterSpacing: 0.5 }}>
          Ideation
        </h1>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 14 }}>{STATUS_LABEL[status]}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button style={btn('#9ad')} onClick={onEnter}>
            Enter VR
          </button>
          {talking ? (
            <button style={btn('#e88')} onClick={onDisconnect}>
              Stop talking
            </button>
          ) : (
            <button style={btn('#9d8')} onClick={onConnect}>
              Start talking
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function btn(bg: string): CSSProperties {
  return {
    pointerEvents: 'auto',
    fontSize: 16,
    fontWeight: 600,
    color: '#0a0a0f',
    background: bg,
    border: 'none',
    borderRadius: 10,
    padding: '12px 22px',
    cursor: 'pointer',
  }
}
