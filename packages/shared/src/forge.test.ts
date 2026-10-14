import { describe, expect, it } from 'vitest'
import { formatCi, type PullRequestCheck } from './forge'

const check = (
  name: string,
  conclusion: string | null,
  status: PullRequestCheck['status'] = 'completed',
): PullRequestCheck => ({ name, status, conclusion, url: '' })

describe('formatCi', () => {
  it('lists each check conclusion', () => {
    expect(
      formatCi({
        number: 12,
        title: 'Update the button',
        checks: [check('build', 'failure'), check('lint', 'success')],
      }),
    ).toBe('CI for PR #12 Update the button:\n- build: failure\n- lint: success')
  })

  it('says when the pull request has no checks', () => {
    expect(formatCi({ number: 12, title: 'Update the button', checks: [] })).toBe(
      'CI for PR #12 Update the button:\nNo checks.',
    )
  })

  it('treats a check without a conclusion as pending', () => {
    expect(formatCi({ number: 3, title: 'Wait', checks: [check('build', null, 'in_progress')] })).toBe(
      'CI for PR #3 Wait:\n- build: pending',
    )
  })
})
