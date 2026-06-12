import { afterEach, describe, expect, it } from 'vitest'
import { registerCapturer, captureScene } from './sceneCapture'

describe('sceneCapture bridge', () => {
  afterEach(() => registerCapturer(null))

  it('returns null when no capturer is registered', async () => {
    expect(await captureScene()).toBeNull()
  })

  it('delegates to the registered capturer with the request', async () => {
    registerCapturer(async (req) => `img:${req.focusId ?? 'forward'}`)
    expect(await captureScene({ focusId: 'model-1' })).toBe('img:model-1')
    expect(await captureScene()).toBe('img:forward')
  })

  it('returns null (never throws) if the capturer rejects', async () => {
    registerCapturer(async () => {
      throw new Error('boom')
    })
    expect(await captureScene()).toBeNull()
  })
})
