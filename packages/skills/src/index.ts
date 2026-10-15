import fixCi from './fix-ci/SKILL.md?raw'
import thermoNuclear from './thermo-nuclear-code-quality-review/SKILL.md?raw'

export interface Skill {
  name: string
  description: string
  /** The instructions, without the frontmatter. */
  body: string
}

/** Split `---` frontmatter (flat `key: value` lines) from the body of a SKILL.md. */
export function parseSkill(source: string): Skill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source)
  if (!match) throw new Error('Skill is missing its frontmatter.')
  const fields = new Map<string, string>()
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const name = fields.get('name')
  const description = fields.get('description')
  if (!name || !description) throw new Error('Skill frontmatter needs a name and a description.')
  return { name, description, body: match[2]!.trim() }
}

export const thermoNuclearCodeQualityReview = parseSkill(thermoNuclear)
export const fixCiSkill = parseSkill(fixCi)

/** Every bundled skill, by name. */
export const skills: Readonly<Record<string, Skill>> = {
  [thermoNuclearCodeQualityReview.name]: thermoNuclearCodeQualityReview,
  [fixCiSkill.name]: fixCiSkill,
}
