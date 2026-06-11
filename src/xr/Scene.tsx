import { Grid } from '@react-three/drei'
import type { RealtimeStatus } from '../agent/realtime'
import { AgentAvatar } from './AgentAvatar'
import { SceneObjects } from './SceneObjects'

// The blank brainstorming room: a softly lit floor with a reference grid, the
// agent's avatar (its presence + control surface), and the objects the agent
// creates and manipulates by voice.
export function Scene({
  status,
  onConnect,
  onDisconnect,
}: {
  status: RealtimeStatus
  onConnect: () => void
  onDisconnect: () => void
}) {
  return (
    <>
      <color attach="background" args={['#0a0a0f']} />
      <fog attach="fog" args={['#0a0a0f', 6, 22]} />

      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 6, 2]} intensity={1.1} castShadow />
      <pointLight position={[-4, 3, -4]} intensity={20} color="#5577ff" />

      {/* Floor grid for spatial reference */}
      <Grid
        position={[0, 0, 0]}
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

      {/* The agent: a floating glass avatar that's also the in-VR control surface. */}
      <AgentAvatar status={status} onConnect={onConnect} onDisconnect={onDisconnect} />
    </>
  )
}
