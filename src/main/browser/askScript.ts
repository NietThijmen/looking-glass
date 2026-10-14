import type { AskOptions } from '@lookingglass/shared/browser'

/**
 * A floating "ask about this" input next to the picked box, in a closed shadow
 * root so page CSS can't touch it. Resolves with what the user chose, or null
 * when it was replaced or hidden from outside.
 */
export function askScript(options: AskOptions): string {
  return `((o) => new Promise((resolve) => {
  window.__lgCancelAsk && window.__lgCancelAsk()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = \`
    * { box-sizing: border-box; font: 12px system-ui, sans-serif; }
    .pop { position: fixed; display: flex; align-items: center; gap: 6px; padding: 6px; pointer-events: auto;
      background: #1f2023; color: #e8e8ea; border: 1px solid #3a3b40; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; color: inherit; background: #131416;
      border: 1px solid #3a3b40; border-radius: 5px; outline: none; font-size: 13px; }
    input:focus { border-color: #3b82f6; }
    button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; flex: none;
      color: #a0a1a8; background: none; border: 0; border-radius: 5px; cursor: pointer; }
    button:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,.08); }
    button:disabled { opacity: .4; cursor: default; }
    button.primary { color: #fff; background: #3b82f6; }
    button.primary:hover:not(:disabled) { background: #2f6fe0; }
    kbd { padding: 0 4px; font-size: 10px; line-height: 16px; border: 1px solid currentColor; border-radius: 3px; opacity: .7; }
  \`
  const pop = document.createElement('div')
  pop.className = 'pop'
  const input = document.createElement('input')
  input.placeholder = o.placeholder
  input.value = o.text
  const button = (label, key, cls) => {
    const b = document.createElement('button')
    if (cls) b.className = cls
    b.append(label + ' ')
    const k = document.createElement('kbd')
    k.textContent = key
    b.append(k)
    return b
  }
  const add = button('Add to chat', 'Esc')
  const fresh = button('New chat', '⌘↵')
  const send = button('Ask', '↵', 'primary')
  pop.append(input, add, fresh, send)
  shadow.append(style, pop)

  const done = (r) => {
    window.__lgCancelAsk = undefined
    host.remove()
    resolve(r)
  }
  window.__lgCancelAsk = () => done(null)
  const result = (type, extra) => done({ type, text: input.value, ...extra })
  const sync = () => { fresh.disabled = send.disabled = !input.value.trim() }
  const submit = (type) => { if (input.value.trim()) result(type) }
  input.addEventListener('input', sync)
  add.onclick = () => result('add')
  fresh.onclick = () => submit('newChat')
  send.onclick = () => submit('send')
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    const arrows = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    if (arrows && o.canWalk && (e.altKey || !input.value)) {
      e.preventDefault()
      result('walk', { direction: e.key === 'ArrowUp' ? 'parent' : 'child' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submit(e.metaKey || e.ctrlKey ? 'newChat' : 'send')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      result('add')
    }
  }, true)
  input.addEventListener('keyup', (e) => e.stopPropagation(), true)
  input.addEventListener('keypress', (e) => e.stopPropagation(), true)

  document.documentElement.append(host)
  const margin = 8
  const width = Math.min(560, innerWidth - margin * 2)
  pop.style.width = width + 'px'
  const height = pop.offsetHeight
  const r = o.rect
  const below = r.y + r.height + margin
  const top = below + height <= innerHeight - margin ? below : r.y - height - margin >= margin ? r.y - height - margin : Math.max(margin, innerHeight - height - margin)
  pop.style.top = top + 'px'
  pop.style.left = Math.max(margin, Math.min(r.x, innerWidth - width - margin)) + 'px'
  sync()
  input.focus()
}))(${JSON.stringify(options)})`
}

export const ASK_CANCEL = 'window.__lgCancelAsk && window.__lgCancelAsk()'
