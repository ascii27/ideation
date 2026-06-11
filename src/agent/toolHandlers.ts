import { useScene, type SpawnArgs, type UpdateArgs } from '../scene/store'
import { findCatalogModel } from '../scene/modelCatalog'
import type { MaterialPreset } from '../scene/materials'

function objectExists(id: string): boolean {
  return useScene.getState().objects.some((o) => o.id === id)
}

// Executes a tool call from the model against the scene store and returns a
// JSON-serializable result (always including the updated scene summary so the
// model stays aware of what exists). Mostly synchronous; image creation awaits a
// backend request. Pure with respect to React — usable in tests.
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const scene = useScene.getState()

  switch (name) {
    case 'spawn_object': {
      const obj = scene.spawn(args as unknown as SpawnArgs)
      return { ok: true, id: obj.id, scene: useScene.getState().summary() }
    }

    case 'update_object': {
      const { id, ...patch } = args as unknown as { id: string } & UpdateArgs
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
        return { ok: true, id: obj.id, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().update(obj.id, { text: 'image failed' })
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
        return { ok: true, id: obj.id, scene: useScene.getState().summary() }
      } catch (err) {
        useScene.getState().update(obj.id, { text: 'model failed' })
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
      try {
        let dataUrl: string
        if (polyhaven) {
          const r = await fetch(`/api/texture?q=${encodeURIComponent(polyhaven)}`)
          const j = (await r.json()) as { dataUrl?: string; error?: string }
          if (!r.ok || !j.dataUrl) throw new Error(j.error ?? `texture failed (${r.status})`)
          dataUrl = j.dataUrl
        } else {
          const r = await fetch('/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, url }),
          })
          const j = (await r.json()) as { dataUrl?: string; error?: string }
          if (!r.ok || !j.dataUrl) throw new Error(j.error ?? `texture failed (${r.status})`)
          dataUrl = j.dataUrl
        }
        useScene.getState().update(id, { textureSrc: dataUrl, textureRepeat: repeat })
        return { ok: true, id, scene: useScene.getState().summary() }
      } catch (err) {
        return { ok: false, id, error: String(err), scene: useScene.getState().summary() }
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

    case 'list_scene':
      return { scene: scene.summary() }

    case 'clear_scene':
      scene.clear()
      return { ok: true, scene: 'The space is empty.' }

    default:
      return { ok: false, error: `Unknown tool "${name}".` }
  }
}
