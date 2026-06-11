// A small curated set of reliable, openly-licensed GLB models. These are the
// "always works, no API key" defaults; the Poly Pizza search (server/models.ts)
// covers the long tail. Models are referenced by URL and loaded through
// /api/models/proxy (same-origin → no CORS taint). Sourced from the Khronos
// glTF Sample Assets (openly licensed — see source link).

export interface CatalogEntry {
  /** Keywords that map a spoken request to this model. */
  keywords: string[]
  title: string
  url: string
  /** Target largest-dimension in meters when spawned. */
  defaultSize: number
  attribution: { author: string; license: string; url?: string }
}

const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models'
const KHRONOS_SRC = 'https://github.com/KhronosGroup/glTF-Sample-Assets'
const khronos = (author: string) => ({ author, license: 'Khronos glTF Sample Assets', url: KHRONOS_SRC })

export const MODEL_CATALOG: CatalogEntry[] = [
  { keywords: ['duck', 'rubber duck'], title: 'Duck', url: `${KHRONOS}/Duck/glTF-Binary/Duck.glb`, defaultSize: 0.6, attribution: khronos('Sony (Khronos sample)') },
  { keywords: ['car', 'toy car', 'vehicle', 'automobile'], title: 'Toy Car', url: `${KHRONOS}/ToyCar/glTF-Binary/ToyCar.glb`, defaultSize: 0.5, attribution: khronos('Khronos sample') },
  { keywords: ['avocado', 'fruit'], title: 'Avocado', url: `${KHRONOS}/Avocado/glTF-Binary/Avocado.glb`, defaultSize: 0.35, attribution: khronos('Khronos sample') },
  { keywords: ['lantern', 'lamp', 'light', 'streetlamp'], title: 'Lantern', url: `${KHRONOS}/Lantern/glTF-Binary/Lantern.glb`, defaultSize: 1.4, attribution: khronos('Microsoft (Khronos sample)') },
  { keywords: ['boombox', 'radio', 'speaker', 'stereo'], title: 'BoomBox', url: `${KHRONOS}/BoomBox/glTF-Binary/BoomBox.glb`, defaultSize: 0.5, attribution: khronos('Khronos sample') },
  { keywords: ['bottle', 'water bottle', 'flask'], title: 'Water Bottle', url: `${KHRONOS}/WaterBottle/glTF-Binary/WaterBottle.glb`, defaultSize: 0.3, attribution: khronos('Khronos sample') },
  { keywords: ['helmet', 'damaged helmet', 'sci-fi helmet'], title: 'Helmet', url: `${KHRONOS}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`, defaultSize: 0.6, attribution: khronos('ctxwing (Khronos sample)') },
]

/** Find a curated model whose keywords best match the spoken query. */
export function findCatalogModel(query: string): CatalogEntry | undefined {
  const q = query.toLowerCase().trim()
  if (!q) return undefined
  return MODEL_CATALOG.find((e) => e.keywords.some((k) => q === k || q.includes(k) || k.includes(q)))
}
