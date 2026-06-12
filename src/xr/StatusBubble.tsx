import { useEffect, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useScene } from '../scene/store'

// A small floating panel above the avatar that shows recent activity (loading
// spinners for in-progress work, then a brief confirmation). Finished lines
// auto-expire; active lines persist until ended by the tool handler.
const EXPIRE_MS = 2800
const LINE_HEIGHT = 0.13
const PANEL_W = 1.1

export function StatusBubble() {
  const activities = useScene((s) => s.activities)
  const dismiss = useScene((s) => s.dismissActivity)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Schedule expiry for any settled (done/error) line not already scheduled.
  useEffect(() => {
    for (const a of activities) {
      if (a.status === 'active') continue
      if (timers.current.has(a.id)) continue
      const t = setTimeout(() => {
        timers.current.delete(a.id)
        dismiss(a.id)
      }, EXPIRE_MS)
      timers.current.set(a.id, t)
    }
  }, [activities, dismiss])

  // Clear timers on unmount.
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  if (activities.length === 0) return null
  const shown = activities.slice(-4) // most recent few
  const panelH = shown.length * LINE_HEIGHT + 0.1

  return (
    <group position={[0, 0.42, 0]}>
      <mesh>
        <planeGeometry args={[PANEL_W, panelH]} />
        <meshBasicMaterial color="#10131c" transparent opacity={0.8} />
      </mesh>
      {shown.map((a, i) => {
        const y = panelH / 2 - 0.08 - i * LINE_HEIGHT
        const dot = a.status === 'active' ? '… ' : a.status === 'error' ? '✕ ' : '✓ '
        const color = a.status === 'error' ? '#ff8a8a' : a.status === 'active' ? '#ffd479' : '#8af0b0'
        return (
          <Text
            key={a.id}
            position={[0, y, 0.01]}
            fontSize={0.075}
            maxWidth={PANEL_W - 0.12}
            color={color}
            anchorX="center"
            anchorY="middle"
          >
            {dot + a.text}
          </Text>
        )
      })}
    </group>
  )
}
