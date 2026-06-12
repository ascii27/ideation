import { Text } from '@react-three/drei'
import type { RealtimeStatus } from '../agent/realtime'
import { useScene } from '../scene/store'
import { VrButton } from './VrButton'

const STATUS_TEXT: Record<RealtimeStatus, string> = {
  idle: 'not connected',
  connecting: 'connecting…',
  connected: 'listening',
  error: 'connection error',
  closed: 'disconnected',
}

// Floating settings/control panel for the agent. Appears below the avatar when
// it's clicked — this is also how you start voice from inside VR. The panel stays
// full-size (so buttons remain readable/clickable) but anchors just under the now
// smaller avatar ball; the offset is comfortable to retune on-headset.
export function SettingsPanel({
  status,
  onConnect,
  onDisconnect,
  onClose,
}: {
  status: RealtimeStatus
  onConnect: () => void
  onDisconnect: () => void
  onClose: () => void
}) {
  const talking = status === 'connected' || status === 'connecting'
  const clear = useScene((s) => s.clear)

  return (
    <group position={[0, -0.5, 0]}>
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[1.15, 1.0]} />
        <meshBasicMaterial color="#10101a" transparent opacity={0.88} />
      </mesh>

      <Text position={[0, 0.38, 0]} fontSize={0.07} color="#b9c2ff" anchorX="center" anchorY="middle">
        Ideation Agent
      </Text>

      <VrButton
        position={[0, 0.16, 0]}
        label={talking ? 'Stop talking' : 'Start talking'}
        color={talking ? '#aa4444' : '#2a9d6a'}
        onClick={talking ? onDisconnect : onConnect}
      />
      <VrButton position={[0, -0.04, 0]} label="Clear the space" color="#3a4060" onClick={() => clear()} />
      <VrButton position={[0, -0.24, 0]} label="Close" color="#2a2f44" onClick={onClose} />

      <Text position={[0, -0.42, 0]} fontSize={0.045} color="#7a83a8" anchorX="center" anchorY="middle">
        {STATUS_TEXT[status]}
      </Text>
    </group>
  )
}
