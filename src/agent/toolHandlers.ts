import { useScene, type SpawnArgs, type UpdateArgs } from '../scene/store'
import { findCatalogModel } from '../scene/modelCatalog'
import type { MaterialPreset } from '../scene/materials'

function objectExists(id: string): boolean {
  return useScene.getState().objects.some((o) => o.id === id)
}

// Fire-and-forget bridge so the browser surfaces what's happening into the
// server's stdout (journalctl on the VM). No-ops outside the browser (e.g. tests)
// and never throws — logging must not affect tool execution.
function logEvent(event: string, data: unknown): void {
  if (typeof window === 'undefined') return
  try {
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
    }).catch(() => {})
  } catch {
    // ignore — logging is best-effort
  }
}

// Resolve a texture to a same-origin data URL: a real Poly Haven CC0 material
// (falling back to generation if Poly Haven lacks the named material), or a
// generated / fetched image. Shared by apply_texture and create_ground.
async function fetchTextureDataUrl(opts: { prompt?: string; url?: string; polyhaven?: string }): Promise<string> {
  const { prompt, url, polyhaven } = opts
  const headers = { 'Content-Type': 'application/json' }
  if (polyhaven) {
    const r = await fetch(`/api/texture?q=${encodeURIComponent(polyhaven)}`)
    const j = (await r.json()) as { dataUrl?: string; error?: string }
    if (r.ok && j.dataUrl) return j.dataUrl
    // No matching CC0 material — generate a tileable texture from the name so
    // common requests (e.g. "granite", which Poly Haven lacks) still succeed.
    logEvent('texture_fallback', { polyhaven, reason: j.error ?? r.status })
    const gr = await fetch('/api/image', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: `seamless tileable ${polyhaven} surface texture, flat top-down view, photographic, even lighting, no shadows`,
      }),
    })
    const gj = (await gr.json()) as { dataUrl?: string; error?: string }
    if (!gr.ok || !gj.dataUrl) throw new Error(gj.error ?? `texture failed (${gr.status})`)
    return gj.dataUrl
  }
  const r = await fetch('/api/image', { method: 'POST', headers, body: JSON.stringify({ prompt, url }) })
  const j = (await r.json()) as { dataUrl?: string; error?: string }
  if (!r.ok || !j.dataUrl) throw new Error(j.error ?? `texture failed (${r.status})`)
  return j.dataUrl
}

// Executes a tool call from the model against the scene store and returns a
// JSON-serializable result (always including the updated scene summary so the
// model stays aware of what exists). Mostly synchronous; image creation awaits a
// backend request. Pure with respect to React — usable in tests.
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const scene = useScene.getState()
  logEvent('tool_call', { name, args })

  switch (name) {
    case 'spawn_object': {
      const obj = scene.spawn(args as unknown as SpawnArgs)
      useScene.getState().toast(`added a ${obj.color} ${obj.kind}`)
      return { ok: true, id: obj.id, scene: useScene.getState().summary() }
    }

    case 'update_object': {
      const { id, ...rest } = args as unknown as { id: string } & UpdateArgs & {
        scale?: unknown
        glow?: unknown
      }
      const patch = rest as UpdateArgs
      if (Array.isArray(rest.scale) && rest.scale.length === 3 && rest.scale.every((n) => typeof n === 'number')) {
        patch.scale = rest.scale as [number, number, number]
      } else {
        delete patch.scale
      }
      if (typeof rest.glow === 'number') patch.glow = Math.max(0, rest.glow)
      else delete patch.glow
      const obj = scene.update(id, patch)
      return obj
        ? { ok: true, id, scene: useScene.getState().summary() }
        : { ok: false, error: `No object with id "${id}".`, scene: scene.summary() }
    }

    case 'delete_object': {
      const id = String((args as { id?: unknown }).id ?? '')
      const ok = scene.remove(id)
      return { ok, ...(ok ? {} : { error: `No object with id "${id}".` }), scene: useScene.getState().summary() }
    }

    case 'create_text_panel': {
      const obj = scene.spawn({
        kind: 'text',
        text: String((args as { text?: unknown }).text ?? ''),
        color: (args as { color?: string }).color,
        position: (args as unknown as SpawnArgs).position,
      })
      useScene.getState().toast('added a note')
      return { ok: true, id: obj.id, scene: useScene.getState().summary() }
    }

    case 'create_image_panel': {
      const prompt = typeof args.prompt === 'string' ? args.prompt : undefined
      const url = typeof args.url === 'string' ? args.url : undefined
      if (!prompt && !url) {
        return { ok: false, error: 'Provide a prompt or a url.', scene: scene.summary() }
      }
      // Placeholder appears immediately while the image loads/generates.
      const obj = scene.spawn({
        kind: 'image',
        size: typeof args.size === 'number' ? args.size : undefined,
        position: (args as unknown as SpawnArgs).position,
        label: prompt ?? url,
      })
      const act = useScene.getState().beginActivity('generating image…')
      try {
        const resp = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, url }),
        })
        const json = (await resp.json()) as { dataUrl?: string; error?: string }
        if (!resp.ok || !json.dataUrl) {
          throw new Error(json.error ?? `image request failed (${resp.status})`)
        }
        useScene.getState().update(obj.id, { src: json.dataUrl })
        useScene.getState().endActivity(act, 'image ready')
        return { ok: true, id: obj.id, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().update(obj.id, { text: 'image failed' })
        useScene.getState().endActivity(act, 'image failed', 'error')
        return { ok: false, id: obj.id, error: String(err), scene: useScene.getState().summary() }
      }
    }

    case 'spawn_model': {
      const query = String((args as { query?: unknown }).query ?? '').trim()
      if (!query) return { ok: false, error: 'A query is required.', scene: scene.summary() }
      const sizeArg = (args as { size?: unknown }).size
      const size = typeof sizeArg === 'number' ? sizeArg : undefined
      const position = (args as unknown as SpawnArgs).position
      const catalog = findCatalogModel(query)

      // Placeholder appears immediately while the GLB loads.
      const obj = scene.spawn({
        kind: 'model',
        size: size ?? catalog?.defaultSize,
        label: catalog?.title ?? query,
        position,
        attribution: catalog?.attribution,
      })
      const act = useScene.getState().beginActivity('finding model…')
      try {
        let glb: string
        let attribution = catalog?.attribution
        if (catalog) {
          glb = catalog.url
        } else {
          const resp = await fetch(`/api/models/search?q=${encodeURIComponent(query)}`)
          const json = (await resp.json()) as {
            results?: Array<{ glb: string; author: string; license: string; title: string }>
            error?: string
          }
          if (!resp.ok) throw new Error(json.error ?? `search failed (${resp.status})`)
          const top = json.results?.[0]
          if (!top) throw new Error(`no model found for "${query}"`)
          glb = top.glb
          attribution = { author: top.author, license: top.license }
        }
        const src = `/api/models/proxy?url=${encodeURIComponent(glb)}`
        useScene.getState().update(obj.id, { src, attribution })
        useScene.getState().endActivity(act, 'model ready')
        return { ok: true, id: obj.id, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().update(obj.id, { text: 'model failed' })
        useScene.getState().endActivity(act, 'model failed', 'error')
        return { ok: false, id: obj.id, error: String(err), scene: useScene.getState().summary() }
      }
    }

    case 'apply_texture': {
      const id = String((args as { id?: unknown }).id ?? '')
      if (!objectExists(id)) return { ok: false, error: `No object with id "${id}".`, scene: scene.summary() }
      const prompt = typeof args.prompt === 'string' ? args.prompt : undefined
      const url = typeof args.url === 'string' ? args.url : undefined
      const polyhaven = typeof args.polyhaven === 'string' ? args.polyhaven : undefined
      const repeat = typeof args.repeat === 'number' ? args.repeat : undefined
      if (!prompt && !url && !polyhaven) {
        return { ok: false, error: 'Provide prompt, url, or polyhaven.', scene: scene.summary() }
      }
      const act = useScene.getState().beginActivity('applying texture…')
      try {
        const dataUrl = await fetchTextureDataUrl({ prompt, url, polyhaven })
        useScene.getState().update(id, { textureSrc: dataUrl, textureRepeat: repeat })
        useScene.getState().endActivity(act, 'texture applied')
        return { ok: true, id, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().endActivity(act, 'texture failed', 'error')
        return { ok: false, id, error: String(err), scene: useScene.getState().summary() }
      }
    }

    case 'create_ground': {
      const textureDesc = typeof args.texture === 'string' ? args.texture : undefined
      const polyhaven = typeof args.polyhaven === 'string' ? args.polyhaven : undefined
      const color = typeof args.color === 'string' ? args.color : undefined
      const size = typeof args.size === 'number' ? args.size : undefined
      // The ground appears immediately (flat color); the texture fills in after.
      const obj = scene.spawn({ kind: 'ground', size, color })
      if (!textureDesc && !polyhaven) {
        return { ok: true, id: obj.id, scene: useScene.getState().summary() }
      }
      const act = useScene.getState().beginActivity('generating ground texture…')
      try {
        const dataUrl = await fetchTextureDataUrl({ prompt: textureDesc, polyhaven })
        useScene.getState().update(obj.id, { textureSrc: dataUrl })
        useScene.getState().endActivity(act, 'ground ready')
        return { ok: true, id: obj.id, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().endActivity(act, 'ground texture failed', 'error')
        return { ok: false, id: obj.id, error: String(err), scene: useScene.getState().summary() }
      }
    }

    case 'set_material': {
      const id = String((args as { id?: unknown }).id ?? '')
      if (!objectExists(id)) return { ok: false, error: `No object with id "${id}".`, scene: scene.summary() }
      const patch: UpdateArgs = {}
      if (typeof args.preset === 'string') patch.materialPreset = args.preset as MaterialPreset
      if (typeof args.color === 'string') patch.color = args.color
      if (typeof args.metalness === 'number') patch.metalness = args.metalness
      if (typeof args.roughness === 'number') patch.roughness = args.roughness
      scene.update(id, patch)
      return { ok: true, id, scene: useScene.getState().summary() }
    }

    case 'set_physics': {
      const patch: { gravity?: boolean; collision?: boolean } = {}
      if (typeof args.gravity === 'boolean') patch.gravity = args.gravity
      if (typeof args.collision === 'boolean') patch.collision = args.collision
      const physics = scene.setPhysics(patch)
      return { ok: true, physics, scene: useScene.getState().summary() }
    }

    case 'set_environment': {
      const patch: Partial<import('../scene/types').EnvironmentState> = {}
      if (typeof args.skyColor === 'string') patch.skyColor = args.skyColor
      if (typeof args.ambientIntensity === 'number') patch.ambientIntensity = Math.max(0, args.ambientIntensity)
      if (typeof args.fog === 'boolean') patch.fog = args.fog
      const environment = scene.setEnvironment(patch)
      useScene.getState().toast('changed the environment')
      return { ok: true, environment, scene: useScene.getState().summary() }
    }

    case 'list_scene':
      return { scene: scene.summary() }

    case 'clear_scene':
      scene.clear()
      return { ok: true, scene: 'The space is empty.' }

    default:
      return { ok: false, error: `Unknown tool "${name}".` }
  }
}
