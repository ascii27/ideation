import { describe, expect, it } from 'vitest'
import { solidHalfHeight, isSolidKind, OBJECT_GROUPS, OBJECT_GROUPS_NO_COLLIDE, FLOOR_GROUPS } from './geometry'
import { effectiveScale, scaledColliderArgs } from './geometry'

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
