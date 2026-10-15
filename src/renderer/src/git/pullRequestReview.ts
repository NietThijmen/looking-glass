import type { PullRequestSummary } from '@lookingglass/shared/forge'
import { thermoNuclearCodeQualityReview } from '@lookingglass/skills'
import { useAgents, type Attachment } from '../store/agents'
import { useWorkspace } from '../store/workspace'

type Checkout = Pick<PullRequestSummary, 'number' | 'head' | 'fromFork'>

/** The branch `checkoutPullRequest` leaves you on. */
export function localBranch(pr: Checkout): string {
  return pr.fromFork ? `pr-${pr.number}` : pr.head
}

/** Switch to the pull request's branch unless it is already there. Resolves to an error message, or null. */
export async function checkoutPullRequest(pr: Checkout): Promise<string | null> {
  if (useWorkspace.getState().git?.branch === localBranch(pr)) return null
  const result = await window.lookingglass.git.checkoutPullRequest(pr)
  return result.ok ? null : (result.error ?? 'Checkout failed')
}

const skillAttachment: Attachment = {
  label: `Skill: ${thermoNuclearCodeQualityReview.name}`,
  blocks: [{ type: 'text', text: thermoNuclearCodeQualityReview.body }],
}

/** Check the pull request out, then start a chat tab that reviews it with the code-quality skill. */
export async function reviewPullRequest(pr: PullRequestSummary): Promise<string | null> {
  const error = await checkoutPullRequest(pr)
  if (error) return error
  const key = await useAgents.getState().newChat(undefined, { title: `Review #${pr.number}` })
  await useAgents
    .getState()
    .send(
      key,
      `Review pull request #${pr.number} "${pr.title}" (${pr.head} into ${pr.base}) with the attached skill. ` +
        `Its branch is checked out. Review the changes with \`git diff origin/${pr.base}...HEAD\`.`,
      [skillAttachment],
    )
  return null
}
