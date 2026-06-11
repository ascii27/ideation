import { Grid } from '@react-three/drei'
import type { RealtimeStatus } from '../agent/realtime'
import { StatusPanel } from './StatusPanel'
import { SceneObjects } from './SceneObjects'

// The blank brainstorming room: a softly lit floor with a reference grid and a
// couple of anchor objects so you can sense scale and orientation once immersed.
// Phase 2+ will populate this space from the agent-driven scene store.
export function Scene({ status }: { status: RealtimeStatus }) {
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

      <StatusPanel status={status} />
    </>
  )
}
