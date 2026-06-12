// Pure geometry + physics-group helpers shared by the store (default resting
// height) and the renderer (collider sizing, collision toggling). No three imports
// and only the pure `interactionGroups` helper from rapier, so it stays unit-testable.

import type { ObjectKind } from './types'
import { interactionGroups } from '@react-three/rapier'

// Physics collision groups (rapier supports 16 groups, indices 0..15).
const GROUP_FLOOR = 0
const GROUP_OBJECT = 1

// Floor collides with objects only.
export const FLOOR_GROUPS = interactionGroups([GROUP_FLOOR], [GROUP_OBJECT])
// Objects collide with the floor AND each other (collision ON).
export const OBJECT_GROUPS = interactionGroups([GROUP_OBJECT], [GROUP_FLOOR, GROUP_OBJECT])
// Objects collide with the floor only — pass through each other (collision OFF).
export const OBJECT_GROUPS_NO_COLLIDE = interactionGroups([GROUP_OBJECT], [GROUP_FLOOR])

// Half-height (in y) of a primitive's unit geometry, scaled by `size`. Placing a
// body at y = solidHalfHeight puts its base on the floor (y = 0). Mirrors the
// geometry dimensions in SceneObjects.tsx (sphere r=0.6, cylinder/cone h=1,
// torus outer=0.7, box=1) all scaled by the mesh `scale={size}`. Panels and
// models return 0 (panels float; models are offset by their bounding box in the
// renderer).
export function solidHalfHeight(kind: ObjectKind, size: number): number {
  switch (kind) {
    case 'sphere':
      return 0.6 * size
    case 'torus':
      return 0.7 * size
    case 'box':
    case 'cylinder':
    case 'cone':
      return 0.5 * size
    default:
      return 0
  }
}

// Solids participate in physics (gravity + collision). Panels (text/image) and
// the ground surface do not.
export function isSolidKind(kind: ObjectKind): boolean {
  return kind !== 'text' && kind !== 'image' && kind !== 'ground'
}

/** Per-axis world scale of a solid: its uniform `size` times optional per-axis
 *  stretch multipliers (default [1,1,1]). Mirrors the mesh scale in SceneObjects. */
export function effectiveScale(size: number, scale?: [number, number, number]): [number, number, number] {
  const s = scale ?? [1, 1, 1]
  return [size * s[0], size * s[1], size * s[2]]
}

export type ColliderSpec =
  | { shape: 'cuboid'; args: [number, number, number] }
  | { shape: 'ball'; args: [number] }
  | { shape: 'cylinder'; args: [number, number] } // [halfHeight, radius]
  | { shape: 'cone'; args: [number, number] } // [halfHeight, radius]

// Analytic collider for a primitive given its already-scaled per-axis extents
// [ex,ey,ez] (= effectiveScale). Matches the unit geometries in SceneObjects
// (sphere r=0.6, cylinder/cone h=1 r=0.5/0.6, torus outer=0.7 tube~0.2, box=1).
// A sphere/cylinder/cone has no exact non-uniform collider in rapier, so radial
// dims use the mean of the relevant axes — a documented approximation.
export function scaledColliderArgs(kind: ObjectKind, e: [number, number, number]): ColliderSpec {
  const [ex, ey, ez] = e
  switch (kind) {
    case 'sphere':
      return { shape: 'ball', args: [0.6 * ((ex + ey + ez) / 3)] }
    case 'cylinder':
      return { shape: 'cylinder', args: [0.5 * ey, 0.5 * ((ex + ez) / 2)] }
    case 'cone':
      return { shape: 'cone', args: [0.5 * ey, 0.6 * ((ex + ez) / 2)] }
    case 'torus':
      return { shape: 'cuboid', args: [0.7 * ex, 0.7 * ey, 0.2 * ez] }
    case 'box':
    default:
      return { shape: 'cuboid', args: [0.5 * ex, 0.5 * ey, 0.5 * ez] }
  }
}
