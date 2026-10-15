import { describe, expect, it } from 'vitest'
import { fixCiSkill, parseSkill, skills, thermoNuclearCodeQualityReview } from './index'

describe('skills', () => {
  it('parses frontmatter from a skill', () => {
    expect(parseSkill('---\nname: a\ndescription: does: a thing\n---\n\n# Body\n')).toEqual({
      name: 'a',
      description: 'does: a thing',
      body: '# Body',
    })
  })

  it('rejects a skill with no frontmatter', () => {
    expect(() => parseSkill('# Body')).toThrow()
  })

  it('bundles the thermo-nuclear review', () => {
    expect(skills['thermo-nuclear-code-quality-review']).toBe(thermoNuclearCodeQualityReview)
    expect(thermoNuclearCodeQualityReview.body.startsWith('# Thermo-Nuclear Code Quality Review')).toBe(true)
  })

  it('bundles the fix-ci skill', () => {
    expect(skills['fix-ci']).toBe(fixCiSkill)
    expect(fixCiSkill.body.startsWith('# Fix CI')).toBe(true)
  })
})
