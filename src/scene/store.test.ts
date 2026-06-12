import { beforeEach, describe, expect, it } from 'vitest'
import { useScene } from './store'
import { handleToolCall } from '../agent/toolHandlers'
import { findCatalogModel } from './modelCatalog'
import { presetToMaterial } from './materials'

beforeEach(() => {
  useScene.getState().clear()
  useScene.getState().setPhysics({ gravity: true, collision: true })
  useScene.getState().setEnvironment({ skyColor: '#0a0a0f', ambientIntensity: 0.4, fog: true })
  useScene.setState({ activities: [] })
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

  it('tracks model attribution and lists unique credits', () => {
    useScene.getState().spawn({
      kind: 'model',
      label: 'Duck',
      src: '/api/models/proxy?url=x',
      attribution: { author: 'Sony', license: 'Khronos sample' },
    })
    expect(useScene.getState().summary()).toContain('model-1 [Duck]: model (Duck)')
    expect(useScene.getState().credits()).toEqual(['Duck — Sony (Khronos sample)'])
  })

  it('persists an absolute position + rotation (as a grab does)', () => {
    const o = useScene.getState().spawn({ kind: 'box' })
    useScene.getState().update(o.id, {
      position: { x: 1.5, y: 0.8, z: -2 },
      rotation: [0, Math.PI / 2, 0],
    })
    const got = useScene.getState().objects[0]
    expect(got.position).toEqual([1.5, 0.8, -2])
    expect(got.rotation).toEqual([0, Math.PI / 2, 0])
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

describe('materials & texturing', () => {
  it('maps presets to physical material params', () => {
    expect(presetToMaterial('metal')).toMatchObject({ metalness: 1 })
    expect(presetToMaterial('glass').transmission).toBeGreaterThan(0)
    expect(presetToMaterial('matte').roughness).toBe(1)
    expect(presetToMaterial(undefined).metalness).toBeLessThan(1)
  })

  it('set_material updates preset/overrides; apply_texture validates target', async () => {
    const box = useScene.getState().spawn({ kind: 'box' })
    await handleToolCall('set_material', { id: box.id, preset: 'metal', roughness: 0.1 })
    const got = useScene.getState().objects[0]
    expect(got.materialPreset).toBe('metal')
    expect(got.roughness).toBe(0.1)
    expect(useScene.getState().summary()).toContain('metal')

    const miss = (await handleToolCall('apply_texture', { id: 'ghost-1', prompt: 'brick' })) as { ok: boolean }
    expect(miss.ok).toBe(false)
  })
})

describe('physics state + resting spawn', () => {
  it('defaults to gravity and collision on', () => {
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: true })
  })

  it('setPhysics flips flags independently, leaving the other unchanged', () => {
    useScene.getState().setPhysics({ gravity: false })
    expect(useScene.getState().physics).toEqual({ gravity: false, collision: true })
    useScene.getState().setPhysics({ collision: false })
    expect(useScene.getState().physics).toEqual({ gravity: false, collision: false })
    useScene.getState().setPhysics({ gravity: true })
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: false })
  })

  it('spawns a primitive resting on the floor (base at y=0)', () => {
    const box = useScene.getState().spawn({ kind: 'box', size: 0.5 })
    expect(box.position[1]).toBeCloseTo(0.25)
  })

  it('spawns a model with its base at the floor (y=0)', () => {
    const m = useScene.getState().spawn({ kind: 'model', size: 0.7 })
    expect(m.position[1]).toBeCloseTo(0)
  })

  it('keeps panels floating (unchanged default height)', () => {
    const t = useScene.getState().spawn({ kind: 'text', text: 'hi' })
    expect(t.position[1]).toBeCloseTo(1.3)
  })

  it('honors an explicit position for solids', () => {
    const box = useScene.getState().spawn({ kind: 'box', position: { x: 0, y: 2, z: -1 } })
    expect(box.position).toEqual([0, 2, -1])
  })
})

describe('ground', () => {
  it('spawns a large flat ground centered just above the floor', () => {
    const g = useScene.getState().spawn({ kind: 'ground' })
    expect(g.kind).toBe('ground')
    expect(g.size).toBe(80)
    expect(g.position[0]).toBe(0)
    expect(g.position[2]).toBe(0)
    expect(g.position[1]).toBeGreaterThan(0)
    expect(g.position[1]).toBeLessThan(0.1)
  })

  it('create_ground without a texture makes a flat-color ground immediately', async () => {
    const r = (await handleToolCall('create_ground', { color: '#556b2f', size: 100 })) as {
      ok: boolean
      id: string
    }
    expect(r.ok).toBe(true)
    const obj = useScene.getState().objects[0]
    expect(obj.kind).toBe('ground')
    expect(obj.size).toBe(100)
    expect(obj.color).toBe('#556b2f')
    expect(obj.textureSrc).toBeUndefined()
    expect(useScene.getState().summary()).toContain('ground')
  })
})

describe('set_physics tool', () => {
  it('toggles gravity and reports the new physics state + scene', async () => {
    const r = (await handleToolCall('set_physics', { gravity: false })) as {
      ok: boolean
      physics: { gravity: boolean; collision: boolean }
      scene: string
    }
    expect(r.ok).toBe(true)
    expect(r.physics).toEqual({ gravity: false, collision: true })
    expect(typeof r.scene).toBe('string')
    expect(useScene.getState().physics.gravity).toBe(false)
  })

  it('toggles collision independently', async () => {
    await handleToolCall('set_physics', { collision: false })
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: false })
  })

  it('with no args is a no-op that still reports state', async () => {
    const r = (await handleToolCall('set_physics', {})) as { ok: boolean; physics: unknown }
    expect(r.ok).toBe(true)
    expect(useScene.getState().physics).toEqual({ gravity: true, collision: true })
  })
})

describe('environment state', () => {
  it('defaults to the prior hardcoded scene values', () => {
    expect(useScene.getState().environment).toEqual({
      skyColor: '#0a0a0f',
      ambientIntensity: 0.4,
      fog: true,
    })
  })

  it('setEnvironment merges partial patches, leaving other fields unchanged', () => {
    useScene.getState().setEnvironment({ skyColor: '#88bbff' })
    expect(useScene.getState().environment).toEqual({
      skyColor: '#88bbff',
      ambientIntensity: 0.4,
      fog: true,
    })
    useScene.getState().setEnvironment({ ambientIntensity: 1.2, fog: false })
    expect(useScene.getState().environment).toEqual({
      skyColor: '#88bbff',
      ambientIntensity: 1.2,
      fog: false,
    })
  })

  it('set_environment tool applies a partial patch and reports state', async () => {
    const r = (await handleToolCall('set_environment', { skyColor: '#223366', ambientIntensity: 1 })) as {
      ok: boolean
      environment: { skyColor: string; ambientIntensity: number; fog: boolean }
      scene: string
    }
    expect(r.ok).toBe(true)
    expect(r.environment).toEqual({ skyColor: '#223366', ambientIntensity: 1, fog: true })
    expect(typeof r.scene).toBe('string')
    expect(useScene.getState().environment.skyColor).toBe('#223366')
  })
})

describe('scale & glow', () => {
  it('persists per-axis scale and glow on spawn and update', () => {
    const o = useScene.getState().spawn({ kind: 'box', scale: [2, 1, 0.5], glow: 1.5 })
    expect(o.scale).toEqual([2, 1, 0.5])
    expect(o.glow).toBe(1.5)
    const u = useScene.getState().update(o.id, { scale: [1, 3, 1], glow: 0 })
    expect(u?.scale).toEqual([1, 3, 1])
    expect(u?.glow).toBe(0)
  })

  it('summary reflects stretched and glowing objects', () => {
    useScene.getState().spawn({ kind: 'box', color: 'red', scale: [3, 1, 1], glow: 2 })
    const s = useScene.getState().summary()
    expect(s).toContain('stretched')
    expect(s).toContain('glowing')
  })

  it('update_object tool applies scale and glow', async () => {
    const box = useScene.getState().spawn({ kind: 'box' })
    const r = (await handleToolCall('update_object', { id: box.id, scale: [1, 2.5, 1], glow: 1 })) as { ok: boolean }
    expect(r.ok).toBe(true)
    const got = useScene.getState().objects[0]
    expect(got.scale).toEqual([1, 2.5, 1])
    expect(got.glow).toBe(1)
  })

  it('update_object ignores a malformed scale (not 3 numbers)', async () => {
    const box = useScene.getState().spawn({ kind: 'box' })
    await handleToolCall('update_object', { id: box.id, scale: [1, 2] })
    expect(useScene.getState().objects[0].scale).toBeUndefined()
  })
})

describe('model catalog', () => {
  it('matches curated models by keyword', () => {
    expect(findCatalogModel('a rubber duck')?.title).toBe('Duck')
    expect(findCatalogModel('sports car')?.title).toBe('Toy Car')
    expect(findCatalogModel('lamp')?.title).toBe('Lantern')
  })

  it('returns undefined for unknown queries', () => {
    expect(findCatalogModel('xyzzy unicorn castle')).toBeUndefined()
  })
})

describe('activity feed', () => {
  it('beginActivity adds an active item and returns its id', () => {
    const id = useScene.getState().beginActivity('generating image…')
    const a = useScene.getState().activities
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id, text: 'generating image…', status: 'active' })
  })

  it('endActivity flips status and can change the text', () => {
    const id = useScene.getState().beginActivity('finding model…')
    useScene.getState().endActivity(id, 'model ready')
    expect(useScene.getState().activities[0]).toMatchObject({ id, text: 'model ready', status: 'done' })
  })

  it('endActivity can mark an error', () => {
    const id = useScene.getState().beginActivity('applying texture…')
    useScene.getState().endActivity(id, 'texture failed', 'error')
    expect(useScene.getState().activities[0].status).toBe('error')
  })

  it('toast adds a one-off done line', () => {
    const id = useScene.getState().toast('changed the sky')
    expect(useScene.getState().activities[0]).toMatchObject({ id, text: 'changed the sky', status: 'done' })
  })

  it('dismissActivity removes by id', () => {
    const id = useScene.getState().toast('added a note')
    useScene.getState().dismissActivity(id)
    expect(useScene.getState().activities).toHaveLength(0)
  })

  it('quick tools emit a toast (e.g. create_text_panel)', async () => {
    await handleToolCall('create_text_panel', { text: 'hi' })
    const texts = useScene.getState().activities.map((a) => a.text)
    expect(texts.some((t) => t.includes('note'))).toBe(true)
  })

  it('a failed image emits an active→error activity', async () => {
    // No network in tests → the fetch throws → activity ends as error.
    await handleToolCall('create_image_panel', { prompt: 'a cat' })
    const a = useScene.getState().activities
    expect(a.some((x) => x.status === 'error')).toBe(true)
  })
})
