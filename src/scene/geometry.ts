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

// Solids participate in physics (gravity + collision). Panels do not.
export function isSolidKind(kind: ObjectKind): boolean {
  return kind !== 'text' && kind !== 'image'
}
