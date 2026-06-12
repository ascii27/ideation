import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  LinearFilter,
  PerspectiveCamera,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import { useScene } from '../scene/store'
import { framingCamera } from '../scene/geometry'
import { registerCapturer, type CaptureRequest } from './captureBridge'

// Square snapshot resolution — small enough to POST cheaply, big enough to recognize.
const SIZE = 512

interface Pending {
  req: CaptureRequest
  resolve: (dataUrl: string) => void
  reject: (err: unknown) => void
}

// Renders the live scene from a chosen camera into an offscreen target and returns a
// JPEG data URL. Registered into the capture bridge so the tool handler can call it.
// Works in immersive XR by toggling gl.xr.enabled off around the render (otherwise
// three forces the headset's stereo cameras and ignores our capture camera).
export function SceneCapture() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const mainCamera = useThree((s) => s.camera)
  const pending = useRef<Pending | null>(null)

  const kit = useMemo(() => {
    const target = new WebGLRenderTarget(SIZE, SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: UnsignedByteType,
    })
    const cam = new PerspectiveCamera(50, 1, 0.05, 200)
    const pixels = new Uint8Array(SIZE * SIZE * 4)
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const head = new Vector3()
    return { target, cam, pixels, canvas, ctx, head }
  }, [])

  useEffect(() => {
    registerCapturer(
      (req) =>
        new Promise<string>((resolve, reject) => {
          // Newest request wins; abandon any previous unfulfilled one.
          pending.current?.reject(new Error('superseded'))
          pending.current = { req, resolve, reject }
        }),
    )
    return () => {
      registerCapturer(null)
      kit.target.dispose()
    }
  }, [kit])

  useFrame(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const { target, cam, pixels, canvas, ctx, head } = kit
    try {
      // --- Position the capture camera ---
      mainCamera.getWorldPosition(head)
      const focus = p.req.focusId
        ? useScene.getState().objects.find((o) => o.id === p.req.focusId)
        : undefined
      if (focus) {
        const { position, target: look } = framingCamera(
          focus.position,
          focus.size,
          [head.x, head.y, head.z],
        )
        cam.position.set(position[0], position[1], position[2])
        cam.lookAt(look[0], look[1], look[2])
      } else {
        cam.position.copy(head)
        mainCamera.getWorldQuaternion(cam.quaternion)
      }
      cam.updateMatrixWorld()

      // --- Render to the offscreen target (XR-safe) ---
      // Restore gl.xr.enabled in a finally so a render error can't leave the
      // headset renderer disabled for the rest of the session.
      const prevXr = gl.xr.enabled
      gl.xr.enabled = false
      try {
        gl.setRenderTarget(target)
        gl.render(scene, cam)
        gl.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels)
        gl.setRenderTarget(null)
      } finally {
        gl.xr.enabled = prevXr
      }

      // --- Blit into a 2D canvas, flipping Y (render-target rows are bottom-up) ---
      const img = ctx.createImageData(SIZE, SIZE)
      const rowBytes = SIZE * 4
      for (let row = 0; row < SIZE; row++) {
        const src = row * rowBytes
        const dst = (SIZE - 1 - row) * rowBytes
        img.data.set(pixels.subarray(src, src + rowBytes), dst)
      }
      ctx.putImageData(img, 0, 0)
      p.resolve(canvas.toDataURL('image/jpeg', 0.8))
    } catch (err) {
      p.reject(err)
    }
  })

  return null
}
