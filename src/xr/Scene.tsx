import { Grid } from '@react-three/drei'
import type { RealtimeStatus } from '../agent/realtime'
import { StatusPanel } from './StatusPanel'

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

      {/* A few anchor objects so the room isn't empty before the agent acts */}
      <mesh position={[0, 1.2, -2.5]} castShadow>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color="#9ad" flatShading metalness={0.2} roughness={0.4} />
      </mesh>
      <mesh position={[-1.6, 0.4, -2]} castShadow>
        <boxGeometry args={[0.6, 0.8, 0.6]} />
        <meshStandardMaterial color="#c97" roughness={0.7} />
      </mesh>
      <mesh position={[1.7, 0.3, -1.8]} castShadow>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshStandardMaterial color="#7c9" roughness={0.5} />
      </mesh>

      <StatusPanel status={status} />
    </>
  )
}
