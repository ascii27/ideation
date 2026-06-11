import { beforeEach, describe, expect, it } from 'vitest'
import { useScene } from './store'
import { handleToolCall } from '../agent/toolHandlers'

beforeEach(() => {
  useScene.getState().clear()
})

describe('scene store', () => {
  it('spawns with per-kind incrementing ids', () => {
    const a = useScene.getState().spawn({ kind: 'box' })
    const b = useScene.getState().spawn({ kind: 'box' })
    const c = useScene.getState().spawn({ kind: 'sphere' })
    expect(a.id).toBe('box-1')
    expect(b.id).toBe('box-2')
    expect(c.id).toBe('sphere-1')
    expect(useScene.getState().objects).toHaveLength(3)
  })

  it('recolors and relatively moves an object', () => {
    const o = useScene.getState().spawn({ kind: 'sphere', color: 'red' })
    const moved = useScene.getState().update(o.id, { color: 'blue', move: { x: 1 } })
    expect(moved?.color).toBe('blue')
    expect(moved?.position[0]).toBeCloseTo(o.position[0] + 1)
  })

  it('returns null when updating a missing id', () => {
    expect(useScene.getState().update('nope-9', { color: 'red' })).toBeNull()
  })

  it('removes objects', () => {
    const o = useScene.getState().spawn({ kind: 'cone' })
    expect(useScene.getState().remove(o.id)).toBe(true)
    expect(useScene.getState().remove(o.id)).toBe(false)
    expect(useScene.getState().objects).toHaveLength(0)
  })

  it('summarizes the scene', () => {
    expect(useScene.getState().summary()).toBe('The space is empty.')
    useScene.getState().spawn({ kind: 'box', color: 'green', label: 'idea' })
    expect(useScene.getState().summary()).toContain('box-1 [idea]: green box')
  })

  it('tracks an image src and reflects loading state in the summary', () => {
    const o = useScene.getState().spawn({ kind: 'image', label: 'a cat' })
    expect(useScene.getState().summary()).toContain('image-1 [a cat]: image (loading)')
    useScene.getState().update(o.id, { src: 'data:image/png;base64,AAAA' })
    expect(useScene.getState().objects[0].src).toBe('data:image/png;base64,AAAA')
    expect(useScene.getState().summary()).toContain('image-1 [a cat]: image at')
  })
})

describe('tool handlers', () => {
  it('spawn_object creates an object and reports the scene', async () => {
    const r = (await handleToolCall('spawn_object', { kind: 'box', color: 'green' })) as {
      ok: boolean
      id: string
      scene: string
    }
    expect(r.ok).toBe(true)
    expect(r.id).toBe('box-1')
    expect(r.scene).toContain('box-1')
    expect(useScene.getState().objects[0].color).toBe('green')
  })

  it('update_object on a missing id reports an error', async () => {
    const r = (await handleToolCall('update_object', { id: 'ghost-1', color: 'red' })) as { ok: boolean }
    expect(r.ok).toBe(false)
  })

  it('create_text_panel makes a text object', async () => {
    const r = (await handleToolCall('create_text_panel', { text: 'hello world' })) as { ok: boolean }
    expect(r.ok).toBe(true)
    const obj = useScene.getState().objects[0]
    expect(obj.kind).toBe('text')
    expect(obj.text).toBe('hello world')
  })

  it('create_image_panel without prompt or url is rejected', async () => {
    const r = (await handleToolCall('create_image_panel', {})) as { ok: boolean }
    expect(r.ok).toBe(false)
    expect(useScene.getState().objects).toHaveLength(0)
  })

  it('clear_scene empties the space', async () => {
    await handleToolCall('spawn_object', { kind: 'box' })
    await handleToolCall('clear_scene', {})
    expect(useScene.getState().objects).toHaveLength(0)
  })

  it('reports unknown tools', async () => {
    const r = (await handleToolCall('frobnicate', {})) as { ok: boolean }
    expect(r.ok).toBe(false)
  })
})
