// The agent-driven scene. The zustand store holding these objects is the single
// source of truth — React Three Fiber renders from it, and it doubles as the
// agent's spatial memory (summarized back to the model after each tool call).

export type ObjectKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'text' | 'image' | 'model'

/** Credit for an openly-licensed asset (CC-BY models need attribution shown). */
export interface Attribution {
  author: string
  license: string
  url?: string
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
}
