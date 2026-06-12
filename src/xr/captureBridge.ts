// A tiny singleton bridge so the non-React tool handler can ask the R3F tree to
// capture a screenshot. Mirrors how the zustand store and the /api/log bridge are
// reachable from anywhere. <SceneCapture/> registers the actual capturer on mount.

export interface CaptureRequest {
  /** Object id to frame; if omitted, capture the user's forward view. */
  focusId?: string
}

type Capturer = (req: CaptureRequest) => Promise<string>

let capturer: Capturer | null = null

/** Registered by <SceneCapture/> on mount; pass null on unmount to clear. */
export function registerCapturer(fn: Capturer | null): void {
  capturer = fn
}

/** Capture the scene as a JPEG data URL. Returns null if no capturer is mounted
 *  (e.g. before the canvas exists, or in unit tests). Never throws. */
export async function captureScene(req: CaptureRequest = {}): Promise<string | null> {
  if (!capturer) return null
  try {
    return await capturer(req)
  } catch {
    return null
  }
}
