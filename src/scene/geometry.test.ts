import { describe, expect, it } from 'vitest'
import { solidHalfHeight, isSolidKind, participatesInPhysics, OBJECT_GROUPS, OBJECT_GROUPS_NO_COLLIDE, FLOOR_GROUPS } from './geometry'
import { effectiveScale, scaledColliderArgs, pivotPlayerPosition, framingCamera } from './geometry'

describe('solidHalfHeight', () => {
  it('returns the y half-extent so the base sits at the floor', () => {
    expect(solidHalfHeight('box', 0.5)).toBeCloseTo(0.25)
    expect(solidHalfHeight('sphere', 0.5)).toBeCloseTo(0.3)
    expect(solidHalfHeight('cylinder', 1)).toBeCloseTo(0.5)
    expect(solidHalfHeight('cone', 1)).toBeCloseTo(0.5)
    expect(solidHalfHeight('torus', 1)).toBeCloseTo(0.7)
  })

  it('scales linearly with size', () => {
    expect(solidHalfHeight('box', 2)).toBeCloseTo(1)
  })

  it('treats panels and models as zero (handled elsewhere)', () => {
    expect(solidHalfHeight('text', 1)).toBe(0)
    expect(solidHalfHeight('image', 1)).toBe(0)
    expect(solidHalfHeight('model', 1)).toBe(0)
  })
})

describe('isSolidKind', () => {
  it('is true for primitives and models, false for panels and ground', () => {
    expect(isSolidKind('box')).toBe(true)
    expect(isSolidKind('model')).toBe(true)
    expect(isSolidKind('text')).toBe(false)
    expect(isSolidKind('image')).toBe(false)
    expect(isSolidKind('ground')).toBe(false)
  })
})

describe('interaction groups', () => {
  it('exposes distinct collide / no-collide bitmasks for objects', () => {
    expect(typeof OBJECT_GROUPS).toBe('number')
    expect(typeof OBJECT_GROUPS_NO_COLLIDE).toBe('number')
    expect(typeof FLOOR_GROUPS).toBe('number')
    expect(OBJECT_GROUPS).not.toBe(OBJECT_GROUPS_NO_COLLIDE)
  })
})

describe('per-axis scale helpers', () => {
  it('effectiveScale multiplies size by per-axis scale, defaulting to uniform', () => {
    expect(effectiveScale(0.5)).toEqual([0.5, 0.5, 0.5])
    expect(effectiveScale(0.5, [2, 1, 0.5])).toEqual([1, 0.5, 0.25])
  })

  it('box collider half-extents scale per axis', () => {
    const c = scaledColliderArgs('box', [1, 2, 0.5])
    expect(c).toEqual({ shape: 'cuboid', args: [0.5, 1, 0.25] })
  })

  it('sphere collider uses the mean scaled radius (no ellipsoid in rapier)', () => {
    const c = scaledColliderArgs('sphere', [1, 2, 3])
    // unit sphere radius 0.6; mean of (0.6,1.2,1.8) = 1.2
    expect(c).toEqual({ shape: 'ball', args: [1.2] })
  })

  it('cylinder collider: half-height from y, radius from mean of x/z', () => {
    const c = scaledColliderArgs('cylinder', [2, 1, 2])
    // halfHeight 0.5*y=0.5 ; radius 0.5*mean(2,2)=1
    expect(c).toEqual({ shape: 'cylinder', args: [0.5, 1] })
  })
})

describe('framingCamera', () => {
  it('targets the object center, slightly raised', () => {
    const { target } = framingCamera([2, 0.5, -3], 1, [0, 1.6, 0])
    expect(target[0]).toBeCloseTo(2)
    expect(target[1]).toBeCloseTo(0.5 + 0.15) // raised by size*0.15
    expect(target[2]).toBeCloseTo(-3)
  })

  it('places the camera on the head side of the object, backed off by ~size', () => {
    // Head at origin, object 4m forward (-z). Camera should sit between them (z > -4).
    const { position } = framingCamera([0, 0, -4], 1, [0, 1.6, 0])
    expect(position[2]).toBeGreaterThan(-4) // toward the head (+z side)
    expect(position[1]).toBeGreaterThan(0) // above center
  })

  it('scales the back-off distance with object size', () => {
    const near = framingCamera([0, 0, -4], 0.5, [0, 1.6, 0]).position
    const far = framingCamera([0, 0, -4], 3, [0, 1.6, 0]).position
    // Bigger object → camera further from it (its z is closer to the head at +z).
    expect(far[2]).toBeGreaterThan(near[2])
  })

  it('falls back to +z when the head coincides with the object', () => {
    const { position } = framingCamera([1, 0, 1], 1, [1, 0, 1])
    expect(Number.isFinite(position[0])).toBe(true)
    expect(Number.isFinite(position[2])).toBe(true)
  })
})

describe('snap-turn pivot', () => {
  it('keeps the head world XZ fixed when only yaw changes (no head offset)', () => {
    // Head directly over the origin: pivoting in place must not move the feet.
    const next = pivotPlayerPosition([0, 0, 0], 0, [0, 1.6, 0], Math.PI / 4)
    expect(next[0]).toBeCloseTo(0)
    expect(next[2]).toBeCloseTo(0)
    expect(next[1]).toBe(0) // feet y unchanged
  })

  it('compensates feet position when the head is offset from the feet', () => {
    // Head 1m forward (-z) of the feet, yaw 0 → rotate 180°. The feet must swing
    // to the opposite side so the head stays at (0,_,-1).
    const next = pivotPlayerPosition([0, 0, 0], 0, [0, 1.6, -1], Math.PI)
    expect(next[0]).toBeCloseTo(0)
    expect(next[2]).toBeCloseTo(-2)
  })
})

describe('participatesInPhysics', () => {
  it('simulates solids that are not opted out', () => {
    expect(participatesInPhysics('box')).toBe(true)
    expect(participatesInPhysics('sphere')).toBe(true)
    expect(participatesInPhysics('model')).toBe(true)
  })

  it('never simulates panels or ground', () => {
    expect(participatesInPhysics('text')).toBe(false)
    expect(participatesInPhysics('image')).toBe(false)
    expect(participatesInPhysics('ground')).toBe(false)
  })

  it('opts a solid out of physics when noPhysics is set', () => {
    expect(participatesInPhysics('box', true)).toBe(false)
    expect(participatesInPhysics('model', true)).toBe(false)
  })
})
