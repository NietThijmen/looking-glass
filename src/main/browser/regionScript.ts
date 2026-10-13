/** Isolated world id for our page scripts: they share the DOM but not the page's JS globals. */
export const REGION_WORLD = 1001

/**
 * A full-page overlay (in a closed shadow root, so page CSS can't touch it)
 * where the user drags a rectangle. Resolves with the rectangle in viewport
 * coordinates once the overlay is gone, or null when cancelled.
 */
export const REGION_SCRIPT = `new Promise((resolve) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.08)'
  const shadow = host.attachShadow({ mode: 'closed' })
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;display:none;border:2px dashed #3b82f6;background:rgba(59,130,246,.15)'
  const hint = document.createElement('div')
  hint.textContent = 'Drag to capture a region · Esc to cancel'
  hint.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:4px 10px;border-radius:4px;font:12px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.75)'
  shadow.append(box, hint)
  let start = null
  const rect = (e) => ({
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y),
  })
  const done = (r) => {
    window.__lgCancelRegion = undefined
    host.remove()
    // Let the overlay disappear from the next frame before the screenshot is taken.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(r)))
  }
  window.__lgCancelRegion = () => done(null)
  host.addEventListener('mousedown', (e) => {
    e.preventDefault()
    start = { x: e.clientX, y: e.clientY }
    box.style.display = 'block'
  })
  host.addEventListener('mousemove', (e) => {
    if (!start) return
    const r = rect(e)
    box.style.left = r.x + 'px'
    box.style.top = r.y + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
  })
  host.addEventListener('mouseup', (e) => {
    if (!start) return
    const r = rect(e)
    done(r.width > 4 && r.height > 4
      ? { ...r, scrollX: window.scrollX, scrollY: window.scrollY, viewport: { width: innerWidth, height: innerHeight } }
      : null)
  })
  document.documentElement.append(host)
})`

export const REGION_CANCEL = 'window.__lgCancelRegion && window.__lgCancelRegion()'
