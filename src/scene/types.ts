// The agent-driven scene. The zustand store holding these objects is the single
// source of truth — React Three Fiber renders from it, and it doubles as the
// agent's spatial memory (summarized back to the model after each tool call).

import type { MaterialPreset } from './materials'

export type ObjectKind =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'text'
  | 'image'
  | 'model'
  // A large flat ground surface the scene sits on (scenery, non-physics).
  | 'ground'

/** Credit for an openly-licensed asset (CC-BY models need attribution shown). */
export interface Attribution {
  author: string
  license: string
  url?: string
}

/** Global physics toggles, controlled by the agent's set_physics tool. */
export interface PhysicsState {
  /** When false, solids float in place (no gravity). */
  gravity: boolean
  /** When false, solids pass through each other (they still rest on the floor). */
  collision: boolean
}

/** Scene-global environment, controlled by the agent's set_environment tool. */
export interface EnvironmentState {
  /** Background + fog color (CSS string). */
  skyColor: string
  /** Ambient light intensity (~0..3). Raise to brighten dark/distant models. */
  ambientIntensity: number
  /** Whether distance fog is drawn (fog color follows skyColor). */
  fog: boolean
}

export interface SceneObject {
  id: string
  kind: ObjectKind
  position: [number, number, number]
  /** Uniform size multiplier in meters-ish (unit geometries are scaled by this).
   *  For image panels this is the panel width in meters. */
  size: number
  /** Euler rotation in radians [x, y, z]. Set by voice or by grabbing. */
  rotation?: [number, number, number]
  /** CSS color string. */
  color: string
  /** Optional human label so the agent can refer back to it. */
  label?: string
  /** Text content for `kind: 'text'` panels. */
  text?: string
  /** For `kind: 'image'`, the image data URL/URL. For `kind: 'model'`, the GLB
   *  URL (served via /api/models/proxy). Empty while loading. */
  src?: string
  /** Asset credit for `kind: 'model'`. */
  attribution?: Attribution
  /** Surface texture (data URL) applied to a primitive's material. */
  textureSrc?: string
  /** Texture tiling factor (repeats per face). */
  textureRepeat?: number
  /** Material preset for a primitive (metal/glass/wood/…). */
  materialPreset?: MaterialPreset
  /** Explicit PBR overrides (take precedence over the preset). */
  metalness?: number
  roughness?: number
  /** Per-axis stretch/squish multipliers on top of `size`. Default [1,1,1]. */
  scale?: [number, number, number]
  /** Light emission strength. 0/undefined = none. >0 = emissive + a point light. */
  glow?: number
  /** Tags this object as part of a visualization group (e.g. "viz-1") so the
   *  whole group can be removed/moved as one unit. Set by the visualize_data
   *  tool; ungrouped objects leave it undefined. */
  groupId?: string
}
