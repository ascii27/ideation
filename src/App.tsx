import { Canvas } from '@react-three/fiber'
import { createXRStore, XR } from '@react-three/xr'
import { Scene } from './xr/Scene'

// A single XR store drives the session. The "Enter VR" button lives in normal
// DOM (the headset browser shows it before you enter immersive mode); the Canvas
// renders the same scene flat on desktop and immersively in the headset.
const xrStore = createXRStore()

export function App() {
  return (
    <>
      <Overlay onEnter={() => xrStore.enterVR()} />
      <Canvas camera={{ position: [0, 1.6, 2.5], fov: 70 }}>
        <XR store={xrStore}>
          <Scene />
        </XR>
      </Canvas>
    </>
  )
}

function Overlay({ onEnter }: { onEnter: () => void }) {
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
        justifyContent: 'flex-start',
        padding: '24px',
        color: '#e8e8f0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ pointerEvents: 'auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px', letterSpacing: 0.5 }}>
          Ideation
        </h1>
        <button
          onClick={onEnter}
          style={{
            pointerEvents: 'auto',
            fontSize: 16,
            fontWeight: 600,
            color: '#0a0a0f',
            background: '#9ad',
            border: 'none',
            borderRadius: 10,
            padding: '12px 22px',
            cursor: 'pointer',
          }}
        >
          Enter VR
        </button>
      </div>
    </div>
  )
}
