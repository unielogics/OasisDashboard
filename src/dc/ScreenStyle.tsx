import { useLayoutEffect } from 'react'

const mounted = new Map<string, number>()

/**
 * Injects a screen's global CSS into <head> verbatim, once per screen (deduped by data-oasis-screen), and removes
 * it again when the last instance unmounts. Runs in a layout effect so the CSS is in place before the first paint.
 * Pages Router only allows global CSS from _app, and the three screens' global sheets differ, hence this helper.
 */
export function ScreenStyle({ id, css }: { id: string; css: string }): null {
  useLayoutEffect(() => {
    const sel = `style[data-oasis-screen="${id}"]`
    mounted.set(id, (mounted.get(id) ?? 0) + 1)
    if (!document.head.querySelector(sel)) {
      const el = document.createElement('style')
      el.setAttribute('data-oasis-screen', id)
      el.textContent = css
      document.head.appendChild(el)
    }
    return () => {
      const left = (mounted.get(id) ?? 1) - 1
      if (left > 0) {
        mounted.set(id, left)
        return
      }
      mounted.delete(id)
      document.head.querySelector(sel)?.remove()
    }
  }, [id, css])
  return null
}
