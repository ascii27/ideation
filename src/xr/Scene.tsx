import { Grid } from '@react-three/drei'
import { TeleportTarget } from '@react-three/xr'
import type { Vector3 } from 'three'
import type { RealtimeStatus } from '../agent/realtime'
import { AgentAvatar } from './AgentAvatar'
import { SceneObjects } from './SceneObjects'
import { CreditsPanel } from './CreditsPanel'

// The blank brainstorming room: a softly lit floor with a reference grid, the
// agent's avatar (its presence + control surface), and the objects the agent
// creates and manipulates by voice. The floor is a teleport target.
export function Scene({
  status,
  onConnect,
  onDisconnect,
  onTeleport,
}: {
  status: RealtimeStatus
  onConnect: () => void
  onDisconnect: () => void
  onTeleport: (point: Vector3) => void
}) {
  return (
    <>
      <color attach="background" args={['#0a0a0f']} />
      <fog attach="fog" args={['#0a0a0f', 6, 22]} />

      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 6, 2]} intensity={1.1} castShadow />
      <pointLight position={[-4, 3, -4]} intensity={20} color="#5577ff" />

      {/* Teleport surface: a near-invisible solid floor the teleport ray can hit
          (the grid is only lines and can't be raycast). Point the controller at
          the floor and release to teleport. */}
      <TeleportTarget onTeleport={onTeleport}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#0c0c16" roughness={1} />
        </mesh>
      </TeleportTarget>

      {/* Floor grid for spatial reference */}
      <Grid
        position={[0, 0.001, 0]}
        args={[30, 30]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#222233"
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor="#3355aa"
        fadeDistance={24}
        fadeStrength={1.5}
        infiniteGrid
      />

      {/* Objects the agent creates and manipulates by voice. */}
      <SceneObjects />

      {/* Attribution for openly-licensed models. */}
      <CreditsPanel />

      {/* The agent: a floating glass avatar that's also the in-VR control surface. */}
      <AgentAvatar status={status} onConnect={onConnect} onDisconnect={onDisconnect} />
    </>
  )
}
