import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, useGLTF } from '@react-three/drei'
import { Handle, type HandleState } from '@react-three/handle'
import {
  Box3,
  DoubleSide,
  type Group,
  type Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { useScene } from '../scene/store'
import { presetToMaterial } from '../scene/materials'
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

function round(n: number): number {
  return Math.round(n * 100) / 100
}

// Wraps an object so it can be grabbed and moved with controllers/hands. The
// wrapper group owns the object's position + rotation; on release we write the
// final transform back to the store so the agent's spatial memory stays correct.
function GrabbableObject({ obj, children }: { obj: SceneObject; children: ReactNode }) {
  const ref = useRef<Group>(null)

  const apply = useCallback(
    (state: HandleState<unknown>, target: Object3D) => {
      target.position.copy(state.current.position)
      target.quaternion.copy(state.current.quaternion)
      if (state.last) {
        const e = target.rotation
        useScene.getState().update(obj.id, {
          position: { x: round(target.position.x), y: round(target.position.y), z: round(target.position.z) },
          rotation: [round(e.x), round(e.y), round(e.z)],
        })
      }
    },
    [obj.id],
  )

  return (
    <group ref={ref} position={obj.position} rotation={obj.rotation ?? [0, 0, 0]}>
      <Handle targetRef={ref} scale={false} multitouch={false} apply={apply}>
        {children}
      </Handle>
    </group>
  )
}

function ObjectView({ obj }: { obj: SceneObject }) {
  let body: ReactNode
  if (obj.kind === 'text') body = <TextBody obj={obj} />
  else if (obj.kind === 'image') body = <ImageBody obj={obj} />
  else if (obj.kind === 'model') body = <ModelBody obj={obj} />
  else body = <PrimitiveBody obj={obj} />
  return <GrabbableObject obj={obj}>{body}</GrabbableObject>
}

function ModelBody({ obj }: { obj: SceneObject }) {
  if (obj.src) {
    return (
      <Suspense fallback={<ModelPlaceholder size={obj.size} label="loading model…" />}>
        <NormalizedModel src={obj.src} size={obj.size} />
      </Suspense>
    )
  }
  return (
    <ModelPlaceholder size={obj.size} label={obj.text === 'model failed' ? 'model failed' : 'finding model…'} />
  )
}

// Raw GLBs vary wildly in scale and pivot, so recenter on the bounding box and
// uniform-scale so the largest dimension is roughly `size` meters.
function NormalizedModel({ src, size }: { src: string; size: number }) {
  const { scene } = useGLTF(src, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const box = new Box3().setFromObject(clone)
    const dims = new Vector3()
    const center = new Vector3()
    box.getSize(dims)
    box.getCenter(center)
    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1
    return { clone, center, scale: size / maxDim }
  }, [scene, size])

  return (
    <group scale={normalized.scale}>
      <primitive
        object={normalized.clone}
        position={[-normalized.center.x, -normalized.center.y, -normalized.center.z]}
      />
    </group>
  )
}

function ModelPlaceholder({ size, label }: { size: number; label: string }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color="#222a3a" transparent opacity={0.45} wireframe />
      </mesh>
      <Text position={[0, size * 0.75, 0]} fontSize={0.1} color="#8a93b8" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  )
}

function PrimitiveBody({ obj }: { obj: SceneObject }) {
  const texture = usePrimitiveTexture(obj.textureSrc, obj.textureRepeat)
  const preset = presetToMaterial(obj.materialPreset)
  const metalness = obj.metalness ?? preset.metalness
  const roughness = obj.roughness ?? preset.roughness
  return (
    <mesh scale={obj.size} castShadow>
      <Primitive kind={obj.kind} />
      <meshPhysicalMaterial
        color={texture ? '#ffffff' : obj.color}
        map={texture ?? undefined}
        metalness={metalness}
        roughness={roughness}
        transmission={preset.transmission}
        clearcoat={preset.clearcoat}
        transparent={preset.transmission > 0}
        ior={1.5}
      />
    </mesh>
  )
}

// Loads a texture for a primitive's material, set up to tile.
function usePrimitiveTexture(src?: string, repeat?: number): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    setTexture(null)
    if (!src) return
    let cancelled = false
    new TextureLoader().load(src, (tex) => {
      if (cancelled) {
        tex.dispose()
        return
      }
      tex.colorSpace = SRGBColorSpace
      tex.wrapS = RepeatWrapping
      tex.wrapT = RepeatWrapping
      const r = repeat && repeat > 0 ? repeat : 1
      tex.repeat.set(r, r)
      setTexture(tex)
    })
    return () => {
      cancelled = true
    }
  }, [src, repeat])
  return texture
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

function ImageBody({ obj }: { obj: SceneObject }) {
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
      <group>
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
    <group>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

function TextBody({ obj }: { obj: SceneObject }) {
  const text = obj.text ?? ''
  const width = Math.max(1.2, Math.min(4, text.length * 0.11))
  return (
    <group>
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
