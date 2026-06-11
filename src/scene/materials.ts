// Material presets the agent can apply to primitives. Pure mapping → physical
// material parameters, so it's testable and shared by the renderer.

export type MaterialPreset = 'metal' | 'glass' | 'plastic' | 'wood' | 'matte'

export interface MaterialProps {
  metalness: number
  roughness: number
  transmission: number
  clearcoat: number
}

export function presetToMaterial(preset?: MaterialPreset): MaterialProps {
  switch (preset) {
    case 'metal':
      return { metalness: 1, roughness: 0.25, transmission: 0, clearcoat: 0 }
    case 'glass':
      return { metalness: 0, roughness: 0.05, transmission: 0.9, clearcoat: 0 }
    case 'plastic':
      return { metalness: 0, roughness: 0.4, transmission: 0, clearcoat: 0.4 }
    case 'wood':
      return { metalness: 0, roughness: 0.8, transmission: 0, clearcoat: 0 }
    case 'matte':
      return { metalness: 0, roughness: 1, transmission: 0, clearcoat: 0 }
    default:
      return { metalness: 0.1, roughness: 0.5, transmission: 0, clearcoat: 0 }
  }
}
