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

/** Whether an object is simulated by physics. Solids (primitives + models) are —
 *  UNLESS individually opted out via `noPhysics`. Visualization objects set the
 *  flag so a chart stays exactly where its layout placed it (it falls through to
 *  the grabbable, non-simulated path). Panels/ground are never solids. */
export function participatesInPhysics(kind: ObjectKind, noPhysics?: boolean): boolean {
  return isSolidKind(kind) && !noPhysics
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

// Rotate a vector (x,z) about the Y axis by `a` radians (three's Y-rotation
// convention: x' = cos·x + sin·z, z' = -sin·x + cos·z).
function rotateXZ(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c * x + s * z, -s * x + c * z]
}

/** Camera placement to frame an object for a snapshot: returns the camera position
 *  and the look-at target (the object center, slightly raised). The camera sits back
 *  from the object toward the viewer (the head's XZ side), high enough and far enough
 *  that an object of the given size roughly fills a ~50° FOV. Pure — no three types. */
export function framingCamera(
  objPos: [number, number, number],
  objSize: number,
  headPos: [number, number, number],
): { position: [number, number, number]; target: [number, number, number] } {
  const dist = Math.max(0.6, objSize * 2.2)
  // Direction from the object toward the head, on the floor plane (fallback +z).
  let dx = headPos[0] - objPos[0]
  let dz = headPos[2] - objPos[2]
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) {
    dx = 0
    dz = 1
  } else {
    dx /= len
    dz /= len
  }
  const center: [number, number, number] = [objPos[0], objPos[1] + objSize * 0.15, objPos[2]]
  return {
    position: [center[0] + dx * dist, center[1] + objSize * 0.4, center[2] + dz * dist],
    target: center,
  }
}

/** New player (feet) position so that snapping the view yaw from `yaw` to
 *  `newYaw` pivots around the head's world position `head` (keeps head XZ fixed).
 *  Feet y is preserved. Used by snap-turn so the player rotates in place. */
export function pivotPlayerPosition(
  playerPos: [number, number, number],
  yaw: number,
  head: [number, number, number],
  newYaw: number,
): [number, number, number] {
  // Head offset in the origin's local frame (un-rotate by current yaw).
  const [lx, lz] = rotateXZ(head[0] - playerPos[0], head[2] - playerPos[2], -yaw)
  // Where that local offset lands after the new yaw.
  const [wx, wz] = rotateXZ(lx, lz, newYaw)
  // Feet = head - rotated offset, keeping head fixed.
  return [head[0] - wx, playerPos[1], head[2] - wz]
}
