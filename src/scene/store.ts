import { create } from 'zustand'
import type { Attribution, EnvironmentState, ObjectKind, PhysicsState, SceneObject } from './types'
import type { MaterialPreset } from './materials'
import { isSolidKind, solidHalfHeight } from './geometry'

export interface Activity {
  id: string
  text: string
  status: 'active' | 'done' | 'error'
}

interface MaterialFields {
  textureSrc?: string
  textureRepeat?: number
  materialPreset?: MaterialPreset
  metalness?: number
  roughness?: number
  scale?: [number, number, number]
  glow?: number
}

export interface SpawnArgs extends MaterialFields {
  kind: ObjectKind
  color?: string
  size?: number
  label?: string
  text?: string
  src?: string
  rotation?: [number, number, number]
  attribution?: Attribution
  position?: { x: number; y: number; z: number }
}

export interface UpdateArgs extends MaterialFields {
  color?: string
  size?: number
  label?: string
  text?: string
  src?: string
  attribution?: Attribution
  /** Euler rotation in radians [x, y, z]. */
  rotation?: [number, number, number]
  /** Absolute position. */
  position?: { x: number; y: number; z: number }
  /** Relative move, added to the current position. */
  move?: { x?: number; y?: number; z?: number }
}

interface SceneState {
  objects: SceneObject[]
  counters: Record<string, number>
  spawn: (args: SpawnArgs) => SceneObject
  update: (id: string, patch: UpdateArgs) => SceneObject | null
  remove: (id: string) => boolean
  clear: () => void
  /** Compact text description fed back to the model so it knows what exists. */
  summary: () => string
  /** Unique asset credits for models currently in the scene. */
  credits: () => string[]
  /** Global physics toggles (gravity + collision). */
  physics: PhysicsState
  /** Update one or both physics flags; omitted flags are left unchanged. */
  setPhysics: (patch: Partial<PhysicsState>) => PhysicsState
  /** Scene-global environment (sky color, ambient light, fog). */
  environment: EnvironmentState
  /** Update one or more environment fields; omitted fields are left unchanged. */
  setEnvironment: (patch: Partial<EnvironmentState>) => EnvironmentState
  /** Transient status feed shown above the avatar (loading/done/toasts). */
  activities: Activity[]
  /** Monotonic id source for activities (internal). */
  activitySeq: number
  /** Start an in-progress activity; returns its id. */
  beginActivity: (text: string) => string
  /** Finish an activity (status done/error), optionally updating its text. */
  endActivity: (id: string, text?: string, status?: 'done' | 'error') => void
  /** Add a one-off completed line (for quick actions). Returns its id. */
  toast: (text: string) => string
  /** Remove an activity by id (the HUD calls this after it expires). */
  dismissActivity: (id: string) => void
}

// The ground surface sits centered on the origin, just above y=0 so it covers the
// reference grid without z-fighting (objects still rest on the physics floor at 0).
const GROUND_Y = 0.02

// When no explicit position is given, place new objects in a loose arc in front
// of the user (who stands near the origin looking toward -z). Solids rest on the
// floor (base at y=0); panels float at eye-ish height; the ground is centered low.
function defaultPosition(index: number, kind: ObjectKind, size: number): [number, number, number] {
  if (kind === 'ground') return [0, GROUND_Y, 0]
  const angle = -0.6 + 0.35 * index
  const radius = 2.2
  const x = round(Math.sin(angle) * radius)
  const z = round(-Math.cos(angle) * radius)
  const y = isSolidKind(kind) ? round(solidHalfHeight(kind, size)) : 1.3
  return [x, y, z]
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export const useScene = create<SceneState>((set, get) => ({
  objects: [],
  counters: {},
  physics: { gravity: true, collision: true },
  environment: { skyColor: '#0a0a0f', ambientIntensity: 0.4, fog: true },
  activities: [],
  activitySeq: 0,

  beginActivity: (text) => {
    const seq = get().activitySeq + 1
    const id = `act-${seq}`
    set({ activitySeq: seq, activities: [...get().activities, { id, text, status: 'active' }] })
    return id
  },

  endActivity: (id, text, status = 'done') => {
    set({
      activities: get().activities.map((a) =>
        a.id === id ? { ...a, status, text: text ?? a.text } : a,
      ),
    })
  },

  toast: (text) => {
    const seq = get().activitySeq + 1
    const id = `act-${seq}`
    set({ activitySeq: seq, activities: [...get().activities, { id, text, status: 'done' }] })
    return id
  },

  dismissActivity: (id) => {
    set({ activities: get().activities.filter((a) => a.id !== id) })
  },

  spawn: (args) => {
    const { counters, objects } = get()
    const n = (counters[args.kind] ?? 0) + 1
    const size =
      args.size ??
      (args.kind === 'text'
        ? 1
        : args.kind === 'image'
          ? 1.5
          : args.kind === 'model'
            ? 0.7
            : args.kind === 'ground'
              ? 80
              : 0.5)
    const obj: SceneObject = {
      id: `${args.kind}-${n}`,
      kind: args.kind,
      position: args.position
        ? [args.position.x, args.position.y, args.position.z]
        : defaultPosition(objects.length, args.kind, size),
      size,
      rotation: args.rotation,
      color: args.color ?? '#99aadd',
      label: args.label,
      text: args.text,
      src: args.src,
      attribution: args.attribution,
      textureSrc: args.textureSrc,
      textureRepeat: args.textureRepeat,
      materialPreset: args.materialPreset,
      metalness: args.metalness,
      roughness: args.roughness,
      scale: args.scale,
      glow: args.glow,
    }
    set({ objects: [...objects, obj], counters: { ...counters, [args.kind]: n } })
    return obj
  },

  update: (id, patch) => {
    const { objects } = get()
    const idx = objects.findIndex((o) => o.id === id)
    if (idx === -1) return null
    const cur = objects[idx]
    const next: SceneObject = { ...cur }
    if (patch.color !== undefined) next.color = patch.color
    if (patch.size !== undefined) next.size = patch.size
    if (patch.label !== undefined) next.label = patch.label
    if (patch.text !== undefined) next.text = patch.text
    if (patch.src !== undefined) next.src = patch.src
    if (patch.attribution !== undefined) next.attribution = patch.attribution
    if (patch.textureSrc !== undefined) next.textureSrc = patch.textureSrc
    if (patch.textureRepeat !== undefined) next.textureRepeat = patch.textureRepeat
    if (patch.materialPreset !== undefined) next.materialPreset = patch.materialPreset
    if (patch.metalness !== undefined) next.metalness = patch.metalness
    if (patch.roughness !== undefined) next.roughness = patch.roughness
    if (patch.scale !== undefined) next.scale = patch.scale
    if (patch.glow !== undefined) next.glow = patch.glow
    if (patch.rotation !== undefined) next.rotation = patch.rotation
    if (patch.position) {
      next.position = [patch.position.x, patch.position.y, patch.position.z]
    }
    if (patch.move) {
      next.position = [
        round(cur.position[0] + (patch.move.x ?? 0)),
        round(cur.position[1] + (patch.move.y ?? 0)),
        round(cur.position[2] + (patch.move.z ?? 0)),
      ]
    }
    const copy = objects.slice()
    copy[idx] = next
    set({ objects: copy })
    return next
  },

  remove: (id) => {
    const { objects } = get()
    if (!objects.some((o) => o.id === id)) return false
    set({ objects: objects.filter((o) => o.id !== id) })
    return true
  },

  clear: () => set({ objects: [], counters: {} }),

  setPhysics: (patch) => {
    const next: PhysicsState = { ...get().physics, ...patch }
    set({ physics: next })
    return next
  },

  setEnvironment: (patch) => {
    const next: EnvironmentState = { ...get().environment, ...patch }
    set({ environment: next })
    return next
  },

  summary: () => {
    const { objects } = get()
    if (objects.length === 0) return 'The space is empty.'
    const parts = objects.map((o) => {
      const p = o.position.map((v) => v.toFixed(1)).join(', ')
      const lbl = o.label ? ` [${o.label}]` : ''
      let desc: string
      if (o.kind === 'text') desc = `text "${o.text ?? ''}"`
      else if (o.kind === 'image') desc = o.src ? 'image' : 'image (loading)'
      else if (o.kind === 'model') desc = o.src ? `model (${o.label ?? 'object'})` : 'model (loading)'
      else if (o.kind === 'ground') desc = o.textureSrc ? 'ground (textured)' : `${o.color} ground`
      else {
        const finish = o.textureSrc ? ' textured' : o.materialPreset ? ` ${o.materialPreset}` : ''
        const stretched = o.scale && (o.scale[0] !== o.scale[1] || o.scale[1] !== o.scale[2]) ? ' stretched' : ''
        const glowing = o.glow && o.glow > 0 ? ' glowing' : ''
        desc = `${o.color} ${o.kind}${finish}${stretched}${glowing}`
      }
      return `${o.id}${lbl}: ${desc} at (${p})`
    })
    return `${objects.length} object(s): ${parts.join('; ')}`
  },

  credits: () => {
    const seen = new Set<string>()
    for (const o of get().objects) {
      if (o.attribution) {
        seen.add(`${o.label ?? 'model'} — ${o.attribution.author} (${o.attribution.license})`)
      }
    }
    return [...seen]
  },
}))
