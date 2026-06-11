import { useScene, type SpawnArgs, type UpdateArgs } from '../scene/store'

// Executes a tool call from the model against the scene store and returns a
// JSON-serializable result (always including the updated scene summary so the
// model stays aware of what exists). Pure with respect to React — usable in tests.
export function handleToolCall(name: string, args: Record<string, unknown>): unknown {
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

    case 'list_scene':
      return { scene: scene.summary() }

    case 'clear_scene':
      scene.clear()
      return { ok: true, scene: 'The space is empty.' }

    default:
      return { ok: false, error: `Unknown tool "${name}".` }
  }
}
