import { Text } from '@react-three/drei'
import type { RealtimeStatus } from '../agent/realtime'

const PRESENTATION: Record<RealtimeStatus, { color: string; label: string }> = {
  idle: { color: '#8888aa', label: 'Tap “Start talking” to begin' },
  connecting: { color: '#ffcc66', label: 'Connecting…' },
  connected: { color: '#77cc99', label: 'Listening — talk to me' },
  error: { color: '#ff6666', label: 'Connection error' },
  closed: { color: '#8888aa', label: 'Session ended' },
}

// A floating status panel in the room so you can see the agent's connection
// state once you're immersed in VR.
export function StatusPanel({ status }: { status: RealtimeStatus }) {
  const { color, label } = PRESENTATION[status]
  return (
    <group position={[0, 2.3, -2.5]}>
      <mesh>
        <planeGeometry args={[2.6, 0.55]} />
        <meshBasicMaterial color="#15151f" transparent opacity={0.82} />
      </mesh>
      <Text position={[0, 0, 0.01]} fontSize={0.17} color={color} anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  )
}
