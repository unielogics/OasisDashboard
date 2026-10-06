import { useLayoutEffect } from 'react'

/**
 * Injects a screen's global CSS into <head> verbatim, once per screen (deduped by data-oasis-screen) and removes
 * it again on unmount. Runs in a layout effect so the CSS is in place before the first paint. Pages Router only
 * allows global CSS from _app, and the three screens' global sheets differ, hence this helper.
 */
export function ScreenStyle({ id, css }: { id: string; css: string }): null {
  useLayoutEffect(() => {
    const sel = `style[data-oasis-screen="${id}"]`
    let el = document.head.querySelector<HTMLStyleElement>(sel)
    let owned = false
    if (!el) {
      el = document.createElement('style')
      el.setAttribute('data-oasis-screen', id)
      el.textContent = css
      document.head.appendChild(el)
      owned = true
    }
    return () => {
      if (owned) el.remove()
    }
  }, [id, css])
  return null
}
