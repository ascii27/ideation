import { useEffect, useState } from 'react'
import { Text } from '@react-three/drei'
import { DoubleSide, SRGBColorSpace, type Texture, TextureLoader } from 'three'
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
  if (obj.kind === 'image') return <ImagePanel obj={obj} />
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

function ImagePanel({ obj }: { obj: SceneObject }) {
  const [texture, setTexture] = useState<Texture | null>(null)
  const [aspect, setAspect] = useState(1)

  useEffect(() => {
    setTexture(null)
    if (!obj.src) return
    let cancelled = false
    new TextureLoader().load(obj.src, (tex) => {
      if (cancelled) {
        tex.dispose()
        return
      }
      tex.colorSpace = SRGBColorSpace
      const img = tex.image as { width: number; height: number }
      if (img.width && img.height) setAspect(img.width / img.height)
      setTexture(tex)
    })
    return () => {
      cancelled = true
    }
  }, [obj.src])

  const width = obj.size
  const height = width / aspect

  if (!texture) {
    // Loading / generating placeholder.
    return (
      <group position={obj.position}>
        <mesh>
          <planeGeometry args={[width, width * 0.66]} />
          <meshBasicMaterial color="#1b2030" transparent opacity={0.9} />
        </mesh>
        <Text position={[0, 0, 0.01]} fontSize={0.1} color="#8a93b8" anchorX="center" anchorY="middle">
          {obj.text === 'image failed' ? 'image failed' : 'generating…'}
        </Text>
      </group>
    )
  }

  return (
    <group position={obj.position}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
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
