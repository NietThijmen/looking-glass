import { describe, expect, it } from 'vitest'
import {
  acceleratorFromEvent,
  expandPrompts,
  formatAccelerator,
  isValidAccelerator,
  type KeyPress,
} from './settings'

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

describe('expandPrompts', () => {
  const prompts = [{ name: 'release', text: 'Cut a release.' }]
  it('expands known !names at the start or after whitespace', () => {
    expect(expandPrompts('!release', prompts)).toBe('Cut a release.')
    expect(expandPrompts('please !release now', prompts)).toBe('please Cut a release. now')
  })
  it('leaves unknown names and mid-word bangs alone', () => {
    expect(expandPrompts('!deploy', prompts)).toBe('!deploy')
    expect(expandPrompts('wow!release', prompts)).toBe('wow!release')
  })

  it('appends arguments when the prompt has no placeholders', () => {
    expect(expandPrompts('!release 1.2 beta', prompts)).toBe('Cut a release. 1.2 beta')
  })
  it('fills $1…$9 and $ARGUMENTS, with quotes grouping words', () => {
    const p = [{ name: 'deploy', text: 'Deploy $1 to "$2" ($ARGUMENTS) $3' }]
    expect(expandPrompts('!deploy api "eu west"', p)).toBe('Deploy api to "eu west" (api "eu west") ')
    expect(expandPrompts('x\n!deploy a b\ny', p)).toBe('x\nDeploy a to "b" (a b) \ny')
  })
  it('does not treat !name. as a call', () => {
    expect(expandPrompts('!release.', prompts)).toBe('!release.')
  })
})
