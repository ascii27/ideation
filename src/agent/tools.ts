// Tool (function) schemas advertised to the OpenAI Realtime model. This module is
// pure data (no imports) so the Node server can import it to put into the session
// config while the browser uses it to know the tool surface. Handlers live in
// toolHandlers.ts and mutate the scene store.

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

const position = {
  type: 'object',
  description: 'Position in meters. x = right, y = up (floor is 0), z = forward is negative (in front of the user).',
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
  required: ['x', 'y', 'z'],
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'spawn_object',
    description:
      'Create a new 3D object in the brainstorming space. Use this when the person wants something to appear. If position is omitted it is placed in front of the user automatically.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['box', 'sphere', 'cylinder', 'cone', 'torus'],
          description: 'The shape to create.',
        },
        color: { type: 'string', description: 'CSS color name or hex, e.g. "red" or "#ff8800".' },
        size: { type: 'number', description: 'Approximate size in meters. Default 0.5.' },
        label: { type: 'string', description: 'Optional short name to remember this object by.' },
        position,
      },
      required: ['kind'],
    },
  },
  {
    type: 'function',
    name: 'update_object',
    description:
      'Modify an existing object: recolor, resize, move, or rotate it. Reference it by its id (e.g. "box-1") from the scene summary.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object id, e.g. "box-1".' },
        color: { type: 'string', description: 'New CSS color.' },
        size: { type: 'number', description: 'New size in meters.' },
        label: { type: 'string', description: 'New label.' },
        position,
        move: {
          type: 'object',
          description: 'Relative move in meters added to the current position.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        },
        rotation: {
          type: 'array',
          description: 'Absolute Euler rotation in radians as [x, y, z].',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
        },
        scale: {
          type: 'array',
          description:
            'Absolute per-axis stretch multipliers [x, y, z]. 1 = unchanged, 2 = twice as long on that axis, 0.5 = squished to half. Use to stretch or squish an object (e.g. [1, 3, 1] makes it tall and thin).',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
        },
        glow: {
          type: 'number',
          description:
            'Make the object emit light (be a light source). 0 = off. ~1 = soft like a candle, higher (~3+) = bright like a lamp or sun. The glow takes the object\'s color.',
        },
      },
      required: ['id'],
    },
  },
  {
    type: 'function',
    name: 'apply_texture',
    description:
      'Apply a surface texture to any object — a primitive (box/sphere/etc.) or a 3D model (e.g. a boulder, a chair). Either generate the texture from a description (prompt), use an image URL, or name a real material for the Poly Haven CC0 library (polyhaven); if Poly Haven has no match the texture is generated from that name automatically. Reference the object by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object id, e.g. "box-1".' },
        prompt: { type: 'string', description: 'Describe a texture to generate, e.g. "seamless red brick".' },
        url: { type: 'string', description: 'A direct image URL to use as the texture.' },
        polyhaven: {
          type: 'string',
          description: 'A real material name to fetch from Poly Haven, e.g. "oak wood", "marble", "rusty metal".',
        },
        repeat: { type: 'number', description: 'Tiling factor (repeats per face). Default 1. Use 2-4 for seamless materials.' },
      },
      required: ['id'],
    },
  },
  {
    type: 'function',
    name: 'set_material',
    description:
      'Change the material/finish of a primitive object — make it look like metal, glass, plastic, wood, or matte, or set custom metalness/roughness. Reference the object by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The object id, e.g. "box-1".' },
        preset: {
          type: 'string',
          enum: ['metal', 'glass', 'plastic', 'wood', 'matte'],
          description: 'A material finish.',
        },
        color: { type: 'string', description: 'Optional new color.' },
        metalness: { type: 'number', description: 'Override metalness 0..1.' },
        roughness: { type: 'number', description: 'Override roughness 0..1.' },
      },
      required: ['id'],
    },
  },
  {
    type: 'function',
    name: 'delete_object',
    description: 'Remove an object from the space by its id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The object id to remove.' } },
      required: ['id'],
    },
  },
  {
    type: 'function',
    name: 'create_text_panel',
    description:
      'Place a floating text panel in the space — for capturing an idea, a note, a heading, or a short list.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to show.' },
        color: { type: 'string', description: 'Optional text color.' },
        position,
      },
      required: ['text'],
    },
  },
  {
    type: 'function',
    name: 'spawn_model',
    description:
      'Add a real 3D model from the object library — recognizable things like a chair, tree, car, animal, building, or tool. Prefer this over primitives when the person names an actual object. Describe what you want and the closest model is found and placed.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to add, e.g. "wooden chair", "oak tree", "sports car", "duck".',
        },
        size: { type: 'number', description: 'Approx largest dimension in meters. Optional.' },
        position,
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'create_image_panel',
    description:
      'Bring an image into the space as a floating panel. Either generate one from a description (prompt) or pull in a real image from a direct URL. Use this to make ideas visual — moodboards, references, sketches, examples.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A description to generate an image from. Provide either this or url.',
        },
        url: {
          type: 'string',
          description: 'A direct https URL to an existing image. Provide either this or prompt.',
        },
        size: { type: 'number', description: 'Panel width in meters. Default 1.5.' },
        position,
      },
    },
  },
  {
    type: 'function',
    name: 'create_ground',
    description:
      'Lay down a large flat ground surface across the whole space — a wide textured floor the scene sits on (grass, sand, stone, dirt, water, etc.). Use this when the person asks for "ground", a floor, terrain, or a surface underfoot. It covers the reference grid. Describe the surface with texture, or name a real CC0 material with polyhaven; if they don\'t specify, pick a fitting one.',
    parameters: {
      type: 'object',
      properties: {
        texture: {
          type: 'string',
          description: 'Describe the ground surface to generate, e.g. "lush green grass", "beach sand", "cobblestone".',
        },
        polyhaven: {
          type: 'string',
          description: 'A real CC0 ground material to fetch from Poly Haven, e.g. "grass", "forest floor", "gravel".',
        },
        color: { type: 'string', description: 'Base color if no texture is used (CSS color/hex).' },
        size: { type: 'number', description: 'Side length in meters. Default 80 (large).' },
      },
    },
  },
  {
    type: 'function',
    name: 'set_physics',
    description:
      'Turn physics on or off in the space. gravity controls whether solid objects fall and settle (off = they float frozen in place). collision controls whether solids bump into each other (off = they pass through; they still rest on the floor). Both are on by default. Set only the flag(s) the person asked to change.',
    parameters: {
      type: 'object',
      properties: {
        gravity: { type: 'boolean', description: 'Whether objects fall under gravity.' },
        collision: { type: 'boolean', description: 'Whether objects collide with each other.' },
      },
    },
  },
  {
    type: 'function',
    name: 'set_environment',
    description:
      'Change the overall environment of the space: the sky/background color, how bright the ambient light is, and whether distance fog (haze) is shown. Raise ambientIntensity (toward ~1) when objects or models look too dark — especially ones that are far away or high up. Set only the field(s) the person asked to change.',
    parameters: {
      type: 'object',
      properties: {
        skyColor: { type: 'string', description: 'CSS color or hex for the sky/background (and fog), e.g. "#88bbff", "skyblue", "black".' },
        ambientIntensity: { type: 'number', description: 'Ambient brightness ~0..3. Default 0.4. Raise to ~1 to brighten dark models, lower toward 0 for a darker mood.' },
        fog: { type: 'boolean', description: 'Whether distance haze is drawn. Defaults on.' },
      },
    },
  },
  {
    type: 'function',
    name: 'look_at_scene',
    description:
      "Actually look at the space with your own eyes by taking a snapshot and seeing what's really there. Use this to check that a model or image you added matches what was asked (the right model doesn't always load), or when the person asks what's in the scene or whether something looks right. Pass focus with an object id (e.g. \"model-1\") to look closely at that one thing; omit it to look at whatever is in front of the person.",
    parameters: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Object id to inspect up close, e.g. "model-1".' },
        question: { type: 'string', description: 'What you want to check, e.g. "is this a wooden chair?".' },
      },
    },
  },
  {
    type: 'function',
    name: 'visualize_data',
    description:
      'Turn a set of data points into a visual in the space — a row of cards, a bar chart, a timeline, or a single big stat. Use this to SHOW data you have (e.g. a weather forecast you just looked up, or numbers you know) instead of only saying it. Provide the data as `series`; pick a `layout` that fits, or omit it to let a sensible one be chosen. Optionally add a `title`. Returns a groupId you can use to remove or move the whole visualization later.',
    parameters: {
      type: 'object',
      properties: {
        series: {
          type: 'array',
          description: 'The data points to show, in order.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short label for this point, e.g. "Mon".' },
              value: { type: 'number', description: 'Primary number — bar height / the stat figure.' },
              secondary: { type: 'number', description: 'A second number to show (e.g. a low temperature).' },
              caption: { type: 'string', description: 'Short qualitative text, e.g. "partly cloudy".' },
              color: { type: 'string', description: 'Optional CSS color for this point.' },
            },
            required: ['label'],
          },
        },
        layout: {
          type: 'string',
          enum: ['card_row', 'bar_chart', 'timeline', 'stat'],
          description: 'How to lay it out. Omit to let a fitting layout be chosen automatically.',
        },
        title: { type: 'string', description: 'Optional heading shown above the visualization.' },
        position,
      },
      required: ['series'],
    },
  },
  {
    type: 'function',
    name: 'list_scene',
    description: 'Get a summary of everything currently in the space and where it is.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'clear_scene',
    description: 'Remove everything from the space. Use only when the person clearly asks to start over.',
    parameters: { type: 'object', properties: {} },
  },
]
