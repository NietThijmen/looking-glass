import { describe, expect, it } from 'vitest'
import { acceleratorFromEvent, formatAccelerator, isValidAccelerator, type KeyPress } from './settings'

const press = (over: Partial<KeyPress>): KeyPress => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

describe('accelerators', () => {
  it('validates Electron accelerators', () => {
    expect(isValidAccelerator('CmdOrCtrl+Shift+E')).toBe(true)
    expect(isValidAccelerator('Ctrl+`')).toBe(true)
    expect(isValidAccelerator('CmdOrCtrl+,')).toBe(true)
    expect(isValidAccelerator('')).toBe(true)
    expect(isValidAccelerator('Hyper+E')).toBe(false)
    expect(isValidAccelerator('CmdOrCtrl+')).toBe(false)
  })

  it('records key presses', () => {
    expect(acceleratorFromEvent(press({ key: 'É', code: 'KeyE', metaKey: true, shiftKey: true }), true)).toBe(
      'CmdOrCtrl+Shift+E',
    )
    expect(acceleratorFromEvent(press({ key: '`', code: 'Backquote', ctrlKey: true }), true)).toBe('Ctrl+`')
    expect(acceleratorFromEvent(press({ key: 'k', code: 'KeyK', ctrlKey: true }), false)).toBe('CmdOrCtrl+K')
    expect(acceleratorFromEvent(press({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true)).toBeNull()
  })

  it('formats for display', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+E', true)).toBe('⌘⇧E')
    expect(formatAccelerator('CmdOrCtrl+Shift+E', false)).toBe('Ctrl+Shift+E')
    expect(formatAccelerator('', true)).toBe('—')
  })
})
