export type ReviewStatus = 'added' | 'modified' | 'deleted'

/** A file changed by an agent that the user hasn't accepted or rejected yet. */
export interface ReviewEntry {
  path: string
  status: ReviewStatus
}
