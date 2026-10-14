import { describe, expect, it } from 'vitest'
import { editorLaunch, isExternalEditorId } from './editors'

describe('editorLaunch', () => {
  it('builds a VS Code URL with line and column', () => {
    expect(editorLaunch('vscode', '/Users/me/app/src/Hero.tsx', 42, 7)).toEqual({
      type: 'url',
      url: 'vscode://file/Users/me/app/src/Hero.tsx:42:7',
    })
  })

  it('uses the editor-specific scheme and omits a missing position', () => {
    expect(editorLaunch('cursor', '/a/b.ts')).toEqual({ type: 'url', url: 'cursor://file/a/b.ts' })
  })

  it('ignores a column without a line', () => {
    expect(editorLaunch('cursor', '/a/b.ts', undefined, 3)).toEqual({
      type: 'url',
      url: 'cursor://file/a/b.ts',
    })
  })

  it('escapes spaces and URL delimiters in paths', () => {
    const launch = editorLaunch('vscode', '/a b/c#d?.ts', 1)
    expect(launch).toEqual({ type: 'url', url: 'vscode://file/a%20b/c%23d%3F.ts:1' })
  })

  it('turns Windows paths into URL paths', () => {
    expect(editorLaunch('vscode', 'C:\\proj\\a.ts', 3)).toEqual({
      type: 'url',
      url: 'vscode://file/C:/proj/a.ts:3',
    })
  })

  it('passes JetBrains launchers --line and --column', () => {
    expect(editorLaunch('webstorm', '/a/b.ts', 12, 4)).toMatchObject({
      type: 'cli',
      command: 'webstorm',
      args: ['--line', '12', '--column', '4', '/a/b.ts'],
    })
    expect(editorLaunch('idea', '/a/b.ts')).toMatchObject({ args: ['/a/b.ts'] })
  })
})

describe('isExternalEditorId', () => {
  it('only accepts known editors', () => {
    expect(isExternalEditorId('cursor')).toBe(true)
    expect(isExternalEditorId('emacs')).toBe(false)
  })
})
