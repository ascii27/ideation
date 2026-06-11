// The agent-driven scene. The zustand store holding these objects is the single
// source of truth — React Three Fiber renders from it, and it doubles as the
// agent's spatial memory (summarized back to the model after each tool call).

export type ObjectKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'text'

export interface SceneObject {
  id: string
  kind: ObjectKind
  position: [number, number, number]
  /** Uniform size multiplier in meters-ish (unit geometries are scaled by this). */
  size: number
  /** CSS color string. */
  color: string
  /** Optional human label so the agent can refer back to it. */
  label?: string
  /** Text content for `kind: 'text'` panels. */
  text?: string
}
