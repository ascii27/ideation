import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, MathUtils, Quaternion, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import type { RealtimeStatus } from '../agent/realtime'
import { sampleAgentLevel } from '../agent/agentAudio'
import { SettingsPanel } from './SettingsPanel'

// State → color: cool blue idle, amber connecting, green listening/speaking, red error.
const STATE_COLOR: Record<RealtimeStatus, string> = {
  idle: '#7aa2ff',
  connecting: '#ffcc66',
  connected: '#5fe39b',
  error: '#ff5a5a',
  closed: '#7aa2ff',
}

const RADIUS = 0.13

// Where the companion hovers relative to the user's head: down, to the right, and
// a little in front, so it sits at the lower-right of the field of view.
const FOLLOW_OFFSET = new Vector3(0.45, -0.35, -0.7)

// The agent's avatar: a glassy floating sphere with a glowing core. It pulses
// while the agent speaks, turns green when listening, amber while connecting, and
// red on error. Click it to open the settings panel (and start/stop voice) —
// which is how you control the agent from inside VR.
export function AgentAvatar({
  status,
  onConnect,
  onDisconnect,
}: {
  status: RealtimeStatus
  onConnect: () => void
  onDisconnect: () => void
}) {
  const [showSettings, setShowSettings] = useState(false)
  const groupRef = useRef<Group>(null)
  const coreRef = useRef<Mesh>(null)
  const level = useRef(0)
  const targetColor = useMemo(() => new Color(STATE_COLOR[status]), [status])

  // Reused scratch objects (avoid per-frame allocation).
  const desired = useMemo(() => new Vector3(), [])
  const camQuat = useMemo(() => new Quaternion(), [])

  useFrame((state, dt) => {
    // --- Lazy body-follow: glide toward a point at the lower-right of the view. ---
    const group = groupRef.current
    if (group) {
      const cam = state.camera
      cam.getWorldQuaternion(camQuat)
      desired.copy(FOLLOW_OFFSET).applyQuaternion(camQuat).add(cam.position)
      // Smooth catch-up: fast enough to keep up, slow enough to "glide".
      const k = 1 - Math.exp(-6 * dt)
      group.position.lerp(desired, k)
      // Face the user.
      group.quaternion.slerp(camQuat, k)
    }

    // --- State color + speaking pulse (unchanged behavior). ---
    const speaking = status === 'connected' ? sampleAgentLevel() : 0
    level.current = MathUtils.damp(level.current, speaking, 6, dt)

    const t = state.clock.elapsedTime
    const breathe = Math.sin(t * 1.4) * 0.02
    const pulse = level.current * 0.8
    const connectingFlash = status === 'connecting' ? Math.abs(Math.sin(t * 4)) * 0.6 : 0

    const core = coreRef.current
    if (core) {
      core.scale.setScalar(1 + breathe + pulse)
      const mat = core.material as MeshStandardMaterial
      mat.color.lerp(targetColor, 0.12)
      mat.emissive.lerp(targetColor, 0.12)
      mat.emissiveIntensity = 0.7 + pulse * 2.6 + connectingFlash
    }
  })

  return (
    <group ref={groupRef}>
      {/* Glass shell — also the click target. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          setShowSettings((v) => !v)
        }}
        onPointerOver={(e) => e.stopPropagation()}
      >
        <sphereGeometry args={[RADIUS * 1.25, 48, 48]} />
        <meshPhysicalMaterial
          color="#cdd9ff"
          transparent
          opacity={0.22}
          roughness={0.05}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.08}
          ior={1.4}
        />
      </mesh>

      {/* Glowing core that carries the state color + pulse. */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[RADIUS * 0.68, 32, 32]} />
        <meshStandardMaterial
          color={STATE_COLOR[status]}
          emissive={STATE_COLOR[status]}
          emissiveIntensity={1}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>

      {showSettings && (
        <SettingsPanel
          status={status}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onClose={() => setShowSettings(false)}
        />
      )}
    </group>
  )
}
