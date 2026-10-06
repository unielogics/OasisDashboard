import { useEffect } from 'react'
import { toastStyle } from './styles'

/** The Payments/Settings toast (single line, bottom centre), cleared after 3 s like their flash(). */
export function Toast({ text, onDone, ms = 3000 }: { text: string | null; onDone: () => void; ms?: number }) {
  useEffect(() => {
    if (!text) return
    const t = setTimeout(onDone, ms)
    return () => clearTimeout(t)
  }, [text, ms, onDone])
  if (!text) return null
  return (
    <div role="status" style={toastStyle}>
      {text}
    </div>
  )
}
