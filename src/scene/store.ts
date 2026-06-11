import { create } from 'zustand'
import type { Attribution, ObjectKind, SceneObject } from './types'
import type { MaterialPreset } from './materials'

interface MaterialFields {
  textureSrc?: string
  textureRepeat?: number
  materialPreset?: MaterialPreset
  metalness?: number
  roughness?: number
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
}

// When no explicit position is given, place new objects in a loose arc in front
// of the user (who stands near the origin looking toward -z).
function defaultPosition(index: number): [number, number, number] {
  const angle = -0.6 + 0.35 * index
  const radius = 2.2
  return [round(Math.sin(angle) * radius), 1.3, round(-Math.cos(angle) * radius)]
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export const useScene = create<SceneState>((set, get) => ({
  objects: [],
  counters: {},

  spawn: (args) => {
    const { counters, objects } = get()
    const n = (counters[args.kind] ?? 0) + 1
    const obj: SceneObject = {
      id: `${args.kind}-${n}`,
      kind: args.kind,
      position: args.position
        ? [args.position.x, args.position.y, args.position.z]
        : defaultPosition(objects.length),
      size: args.size ?? (args.kind === 'text' ? 1 : args.kind === 'image' ? 1.5 : args.kind === 'model' ? 0.7 : 0.5),
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
      else {
        const finish = o.textureSrc ? ' textured' : o.materialPreset ? ` ${o.materialPreset}` : ''
        desc = `${o.color} ${o.kind}${finish}`
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
