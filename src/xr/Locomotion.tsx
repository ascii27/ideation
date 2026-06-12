import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'
import { Vector3 } from 'three'
import { pivotPlayerPosition } from '../scene/geometry'

// Thumbstick locomotion (in addition to point-to-teleport):
//   Left stick  → hop a fixed distance in the pushed direction (relative to gaze).
//   Right stick → snap-turn the view by a fixed angle, pivoting around the head.
// Both are edge-triggered: one action per push, re-armed when the stick recenters.
const HOP_DISTANCE = 1.5
const SNAP_TURN_RADIANS = Math.PI / 4 // 45°
const STICK_ON = 0.7 // push past this to trigger
const STICK_OFF = 0.3 // fall below this to re-arm

export function Locomotion({
  playerPos,
  playerYaw,
  onMove,
  onYaw,
}: {
  playerPos: Vector3
  playerYaw: number
  onMove: (v: Vector3) => void
  onYaw: (yaw: number) => void
}) {
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')
  const hopArmed = useRef(true)
  const turnArmed = useRef(true)

  // Scratch vectors (avoid per-frame allocation).
  const head = useRef(new Vector3()).current
  const fwd = useRef(new Vector3()).current

  useFrame((state) => {
    // --- Snap-turn (right stick X) ---
    const rThumb = right?.gamepad['xr-standard-thumbstick']
    const rx = rThumb?.xAxis ?? 0
    if (turnArmed.current && Math.abs(rx) > STICK_ON) {
      const newYaw = playerYaw - Math.sign(rx) * SNAP_TURN_RADIANS
      state.camera.getWorldPosition(head)
      const next = pivotPlayerPosition(
        [playerPos.x, playerPos.y, playerPos.z],
        playerYaw,
        [head.x, head.y, head.z],
        newYaw,
      )
      onMove(new Vector3(next[0], next[1], next[2]))
      onYaw(newYaw)
      turnArmed.current = false
    } else if (Math.abs(rx) < STICK_OFF) {
      turnArmed.current = true
    }

    // --- Hop (left stick), relative to where the user is looking ---
    const lThumb = left?.gamepad['xr-standard-thumbstick']
    const lx = lThumb?.xAxis ?? 0
    const ly = lThumb?.yAxis ?? 0
    const mag = Math.hypot(lx, ly)
    if (hopArmed.current && mag > STICK_ON) {
      // Gaze-relative basis on the floor plane.
      state.camera.getWorldDirection(fwd)
      fwd.y = 0
      fwd.normalize()
      // right = up × forward = (fz, 0, -fx)
      const rX = fwd.z
      const rZ = -fwd.x
      // Push up = forward; push right = right. (yAxis sign matches this controller:
      // pushing the stick forward moves you toward where you're looking.)
      let dx = fwd.x * ly + rX * lx
      let dz = fwd.z * ly + rZ * lx
      const dLen = Math.hypot(dx, dz) || 1
      dx = (dx / dLen) * HOP_DISTANCE
      dz = (dz / dLen) * HOP_DISTANCE
      onMove(new Vector3(playerPos.x + dx, playerPos.y, playerPos.z + dz))
      hopArmed.current = false
    } else if (mag < STICK_OFF) {
      hopArmed.current = true
    }
  })

  return null
}
