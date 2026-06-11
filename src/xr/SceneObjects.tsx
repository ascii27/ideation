import { Text } from '@react-three/drei'
import { useScene } from '../scene/store'
import type { ObjectKind, SceneObject } from '../scene/types'

// Renders every object in the agent-driven scene store. Re-renders automatically
// as tool calls mutate the store.
export function SceneObjects() {
  const objects = useScene((s) => s.objects)
  return (
    <>
      {objects.map((o) => (
        <ObjectView key={o.id} obj={o} />
      ))}
    </>
  )
}

function ObjectView({ obj }: { obj: SceneObject }) {
  if (obj.kind === 'text') return <TextPanel obj={obj} />
  return (
    <mesh position={obj.position} scale={obj.size} castShadow>
      <Primitive kind={obj.kind} />
      <meshStandardMaterial color={obj.color} roughness={0.5} metalness={0.1} />
    </mesh>
  )
}

function Primitive({ kind }: { kind: ObjectKind }) {
  switch (kind) {
    case 'sphere':
      return <sphereGeometry args={[0.6, 32, 32]} />
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
    case 'cone':
      return <coneGeometry args={[0.6, 1, 32]} />
    case 'torus':
      return <torusGeometry args={[0.5, 0.2, 16, 48]} />
    case 'box':
    default:
      return <boxGeometry args={[1, 1, 1]} />
  }
}

function TextPanel({ obj }: { obj: SceneObject }) {
  const text = obj.text ?? ''
  const width = Math.max(1.2, Math.min(4, text.length * 0.11))
  return (
    <group position={obj.position}>
      <mesh>
        <planeGeometry args={[width, 0.85]} />
        <meshBasicMaterial color="#15151f" transparent opacity={0.85} />
      </mesh>
      <Text
        position={[0, 0, 0.01]}
        maxWidth={width - 0.3}
        fontSize={0.18}
        color={obj.color || '#e8e8f0'}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
      >
        {text}
      </Text>
    </group>
  )
}
