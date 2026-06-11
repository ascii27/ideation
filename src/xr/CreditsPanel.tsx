import { useMemo } from 'react'
import { Text } from '@react-three/drei'
import { useScene } from '../scene/store'

// Small floating attribution panel for openly-licensed models in the scene.
// Only shown when there are credited assets.
export function CreditsPanel() {
  const objects = useScene((s) => s.objects)
  const lines = useMemo(() => useScene.getState().credits(), [objects])
  if (lines.length === 0) return null

  return (
    <group position={[-2.6, 0.5, -1.2]} rotation={[0, Math.PI / 6, 0]}>
      <Text fontSize={0.06} color="#5b6480" anchorX="left" anchorY="top" position={[0, 0.12 * lines.length, 0]}>
        Credits
      </Text>
      {lines.map((line, i) => (
        <Text
          key={line}
          fontSize={0.05}
          color="#6b7498"
          anchorX="left"
          anchorY="top"
          maxWidth={2.2}
          position={[0, 0.12 * lines.length - 0.1 - i * 0.09, 0]}
        >
          {line}
        </Text>
      ))}
    </group>
  )
}
