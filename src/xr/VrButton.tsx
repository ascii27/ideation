import { useState } from 'react'
import { Text } from '@react-three/drei'

// A flat clickable button that works with both mouse (desktop) and XR controller/
// hand rays. Lives in the 3D scene so it's usable inside immersive VR.
export function VrButton({
  position,
  width = 0.9,
  label,
  color,
  onClick,
}: {
  position: [number, number, number]
  width?: number
  label: string
  color: string
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <group position={position}>
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
      >
        <planeGeometry args={[width, 0.15]} />
        <meshBasicMaterial color={color} transparent opacity={hover ? 1 : 0.82} />
      </mesh>
      <Text position={[0, 0, 0.01]} fontSize={0.06} color="#ffffff" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  )
}
