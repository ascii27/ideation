import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, useGLTF } from '@react-three/drei'
import { Handle, type HandleState } from '@react-three/handle'
import {
  RigidBody,
  type RapierRigidBody,
  BallCollider,
  ConeCollider,
  CuboidCollider,
  CylinderCollider,
} from '@react-three/rapier'
import {
  Box3,
  DoubleSide,
  Euler,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { useScene } from '../scene/store'
import { presetToMaterial } from '../scene/materials'
import { isSolidKind, OBJECT_GROUPS, OBJECT_GROUPS_NO_COLLIDE } from '../scene/geometry'
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
  // The ground is static scenery — rendered directly (no grab/physics wrapper).
  if (obj.kind === 'ground') return <GroundBody obj={obj} />

  let body: ReactNode
  if (obj.kind === 'text') body = <TextBody obj={obj} />
  else if (obj.kind === 'image') body = <ImageBody obj={obj} />
  else if (obj.kind === 'model') body = <ModelBody obj={obj} />
  else body = <PrimitiveBody obj={obj} />

  if (isSolidKind(obj.kind)) {
    return <PhysicsObject obj={obj}>{body}</PhysicsObject>
  }
  return <GrabbableObject obj={obj}>{body}</GrabbableObject>
}

// A large flat ground plane the scene sits on. Lies horizontal at the object's y
// (just above the floor so it covers the reference grid), with a tiled texture or
// a flat color. Not grabbable and outside physics — it's scenery, not an object
// you bump into (solids still rest on the physics floor at y=0).
function GroundBody({ obj }: { obj: SceneObject }) {
  const repeat = obj.textureRepeat ?? Math.min(40, Math.max(8, Math.round(obj.size / 4)))
  const texture = usePrimitiveTexture(obj.textureSrc, repeat)
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={obj.position} receiveShadow>
      <planeGeometry args={[obj.size, obj.size]} />
      <meshStandardMaterial
        map={texture ?? undefined}
        color={texture ? '#ffffff' : obj.color}
        roughness={0.95}
        metalness={0}
      />
    </mesh>
  )
}

// Rapier body-type numeric constants (avoid importing the enum name).
const BODY_DYNAMIC = 0
const BODY_KINEMATIC_POSITION = 2

// A solid object as a Rapier rigid body that rests on the floor and collides.
// Grabbing drives it kinematically via @react-three/handle; on release it returns
// to dynamic and its resting transform is written back to the store (agent memory).
// Collision toggling swaps the collider interaction groups; gravity toggling is
// handled globally by the <Physics> gravity prop in Scene.tsx.
//
// The grab target is a SEPARATE, static group at scene/world level — NOT a child
// of the rigid body. @react-three/handle measures the drag delta in the target's
// parent frame, so the target must live in world space; if it were nested under
// the body (which we move to follow the hand) the measured delta would collapse to
// zero and the object would refuse to move. We mirror the body's transform into
// this target every idle frame so each grab starts from the object's real pose,
// then drive the body kinematically from the target-space drag during the grab.
function PhysicsObject({ obj, children }: { obj: SceneObject; children: ReactNode }) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const targetRef = useRef<Group>(null)
  const grabbing = useRef(false)
  const collision = useScene((s) => s.physics.collision)
  const gravity = useScene((s) => s.physics.gravity)

  // Models auto-fit a convex hull; primitives get an exact analytic collider
  // (see PrimitiveCollider) so they touch visually and rest flush on the floor
  // instead of on an oversized boxy padding.
  const isModel = obj.kind === 'model'

  // When the agent moves/repositions the object (store position changes outside of
  // a grab), teleport the rigid body to match and clear its velocity.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.setTranslation({ x: obj.position[0], y: obj.position[1], z: obj.position[2] }, true)
    const r = obj.rotation ?? [0, 0, 0]
    const q = new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2]))
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }, [obj.position, obj.rotation])

  // While not grabbing, keep the static grab-target glued to the body so the next
  // grab anchors at the object's current world pose.
  useFrame(() => {
    if (grabbing.current) return
    const body = bodyRef.current
    const target = targetRef.current
    if (!body || !target) return
    const t = body.translation()
    target.position.set(t.x, t.y, t.z)
    const r = body.rotation()
    target.quaternion.set(r.x, r.y, r.z, r.w)
  })

  const apply = useCallback(
    (state: HandleState<unknown>) => {
      const body = bodyRef.current
      if (!body) return
      if (state.first) {
        grabbing.current = true
        body.setBodyType(BODY_KINEMATIC_POSITION, true)
      }
      const p = state.current.position
      const q = state.current.quaternion
      body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z })
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      if (state.last) {
        grabbing.current = false
        body.setBodyType(BODY_DYNAMIC, true)
        if (!gravity) {
          body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        }
        const t = body.translation()
        const rot = body.rotation()
        const e = new Euler().setFromQuaternion(new Quaternion(rot.x, rot.y, rot.z, rot.w))
        useScene.getState().update(obj.id, {
          position: { x: round(t.x), y: round(t.y), z: round(t.z) },
          rotation: [round(e.x), round(e.y), round(e.z)],
        })
      }
    },
    [obj.id, gravity],
  )

  return (
    <>
      <RigidBody
        ref={bodyRef}
        colliders={false}
        // Models collide with the floor ONLY (never each other) so tightly placed
        // models don't shove each other to uneven heights; their rotation is also
        // locked so trees/furniture rest upright. Primitives collide normally,
        // honoring the collision toggle.
        collisionGroups={isModel ? OBJECT_GROUPS_NO_COLLIDE : collision ? OBJECT_GROUPS : OBJECT_GROUPS_NO_COLLIDE}
        lockRotations={isModel}
        position={obj.position}
        rotation={obj.rotation ?? [0, 0, 0]}
        canSleep
      >
        {/* Explicit colliders, base pinned to y=0. Models get a stable box sized
            from `size` (NOT an auto-hull) so the collider doesn't depend on the
            loaded/placeholder mesh — an auto-hull built from the centered loading
            placeholder ejected the body upward by ~size/2 and floated it. */}
        {isModel ? (
          <CuboidCollider args={[obj.size * 0.35, obj.size * 0.5, obj.size * 0.35]} position={[0, obj.size * 0.5, 0]} />
        ) : (
          <PrimitiveCollider kind={obj.kind} size={obj.size} />
        )}
        {/* targetRef points at the static group below; the pickable mesh (children)
            is bound as the handle surface and stays inside the body. */}
        <Handle targetRef={targetRef} scale={false} multitouch={false} apply={apply}>
          {children}
        </Handle>
      </RigidBody>
      {/* Static world-space grab reference (not moved by physics). */}
      <group ref={targetRef} />
    </>
  )
}

// Analytic collider matching each primitive's geometry (see Primitive() for the
// unit dimensions; all are scaled by `size`). Collider half-extents are centered
// on the body origin, so with the body placed at solidHalfHeight the base lands
// exactly on the floor. Rapier collider args: Cuboid = half-extents; Ball =
// radius; Cylinder/Cone = [halfHeight, radius].
function PrimitiveCollider({ kind, size }: { kind: ObjectKind; size: number }) {
  switch (kind) {
    case 'sphere':
      return <BallCollider args={[0.6 * size]} />
    case 'cylinder':
      return <CylinderCollider args={[0.5 * size, 0.5 * size]} />
    case 'cone':
      return <ConeCollider args={[0.5 * size, 0.6 * size]} />
    case 'torus':
      return <CuboidCollider args={[0.7 * size, 0.7 * size, 0.2 * size]} />
    case 'box':
    default:
      return <CuboidCollider args={[0.5 * size, 0.5 * size, 0.5 * size]} />
  }
}

function ModelBody({ obj }: { obj: SceneObject }) {
  if (obj.src) {
    return (
      <Suspense fallback={<ModelPlaceholder size={obj.size} label="loading model…" />}>
        <NormalizedModel src={obj.src} size={obj.size} textureSrc={obj.textureSrc} textureRepeat={obj.textureRepeat} />
      </Suspense>
    )
  }
  return (
    <ModelPlaceholder size={obj.size} label={obj.text === 'model failed' ? 'model failed' : 'finding model…'} />
  )
}

// Raw GLBs vary wildly in scale and pivot, so recenter on the bounding box in x/z,
// and sit the model's BASE at y=0 (so a rigid body at y=0 rests on the floor).
// Uniform-scale so the largest dimension is roughly `size` meters. Materials are
// cloned per instance so we can override their map when the agent applies a
// texture without mutating the shared cached GLTF.
function NormalizedModel({
  src,
  size,
  textureSrc,
  textureRepeat,
}: {
  src: string
  size: number
  textureSrc?: string
  textureRepeat?: number
}) {
  const { scene } = useGLTF(src, true)
  const texture = usePrimitiveTexture(textureSrc, textureRepeat)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    // Own our materials so map overrides don't leak into the cached GLTF.
    clone.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh || !mesh.material) return
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => (m as Material).clone())
        : (mesh.material as Material).clone()
    })
    const box = new Box3().setFromObject(clone)
    const dims = new Vector3()
    const center = new Vector3()
    box.getSize(dims)
    box.getCenter(center)
    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1
    const scale = size / maxDim
    return {
      clone,
      scale,
      offset: new Vector3(-center.x, -box.min.y, -center.z),
    }
  }, [scene, size])

  // Apply (or clear) an agent-supplied texture across all the model's materials.
  useEffect(() => {
    normalized.clone.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh || !mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const sm = m as MeshStandardMaterial
        if (texture) {
          sm.map = texture
          sm.color?.set('#ffffff') // let the texture provide the color
        }
        sm.needsUpdate = true
      }
    })
  }, [normalized, texture])

  return (
    <group scale={normalized.scale}>
      <primitive
        object={normalized.clone}
        position={[normalized.offset.x, normalized.offset.y, normalized.offset.z]}
      />
    </group>
  )
}

function ModelPlaceholder({ size, label }: { size: number; label: string }) {
  // Sit the placeholder ON the floor (base at y=0), matching where the loaded
  // model lands, so the shape doesn't visibly jump up when it swaps in.
  return (
    <group>
      <mesh position={[0, size / 2, 0]}>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color="#222a3a" transparent opacity={0.45} wireframe />
      </mesh>
      <Text position={[0, size * 1.15, 0]} fontSize={0.1} color="#8a93b8" anchorX="center" anchorY="middle">
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
