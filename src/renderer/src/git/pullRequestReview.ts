import { pullRequestBranch, type PullRequestSummary } from '@lookingglass/shared/forge'
import { fixCiSkill, thermoNuclearCodeQualityReview } from '@lookingglass/skills'
import type { Skill } from '@lookingglass/skills'
import { useAgents, type Attachment } from '../store/agents'
import { useWorkspace } from '../store/workspace'

type Checkout = Pick<PullRequestSummary, 'number' | 'head' | 'fromFork'>

/** Switch to the pull request's branch unless it is already there. Resolves to an error message, or null. */
export async function checkoutPullRequest(pr: Checkout): Promise<string | null> {
  if (useWorkspace.getState().git?.branch === pullRequestBranch(pr)) return null
  const result = await window.lookingglass.git.checkoutPullRequest(pr)
  return result.ok ? null : (result.error ?? 'Checkout failed')
}

function skillAttachment(skill: Skill): Attachment {
  return { label: `Skill: ${skill.name}`, blocks: [{ type: 'text', text: skill.body }] }
}

/** Check the pull request out, then start a chat tab with `prompt` and the skill attached. */
async function startPullRequestChat(
  pr: PullRequestSummary,
  title: string,
  skill: Skill,
  prompt: string,
): Promise<string | null> {
  const error = await checkoutPullRequest(pr)
  if (error) return error
  const key = await useAgents.getState().newChat(undefined, { title })
  await useAgents.getState().send(key, prompt, [skillAttachment(skill)])
  return null
}

export function reviewPullRequest(pr: PullRequestSummary): Promise<string | null> {
  return startPullRequestChat(
    pr,
    `Review #${pr.number}`,
    thermoNuclearCodeQualityReview,
    `Review pull request #${pr.number} "${pr.title}" (${pr.head} into ${pr.base}) with the attached skill. ` +
      `Its branch is checked out. Review the changes with \`git diff origin/${pr.base}...HEAD\`.`,
  )
}

export function fixPullRequestCi(pr: PullRequestSummary): Promise<string | null> {
  return startPullRequestChat(
    pr,
    `Fix CI #${pr.number}`,
    fixCiSkill,
    `CI is failing on pull request #${pr.number} "${pr.title}" (${pr.head} into ${pr.base}). ` +
      `Its branch is checked out. Fix it with the attached skill.`,
  )
}
