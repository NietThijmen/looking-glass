import { PatchDiff } from '@pierre/diffs/react'
import { checkLabel, type PullRequestDetail, type PullRequestFileStatus } from '@lookingglass/shared/forge'
import { useState, type ReactNode } from 'react'
import { Markdown } from '../agent/Markdown'
import { CommentComposer, DescriptionEditor, PullRequestHeaderActions } from './PullRequestActions'
import { useWorkspace } from '../store/workspace'
import { baseOptions } from './diffsConfig'

const diffOptions = { ...baseOptions, diffStyle: 'unified' } as const

const fileMark: Record<PullRequestFileStatus, { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-emerald-400' },
  modified: { letter: 'M', className: 'text-amber-300' },
  deleted: { letter: 'D', className: 'text-red-400' },
  renamed: { letter: 'R', className: 'text-sky-300' },
}

function conclusionClass(label: string): string {
  if (label === 'success') return 'text-green-400'
  if (label === 'failure') return 'text-red-400'
  if (label === 'pending') return 'text-amber-300'
  return 'text-muted'
}

/** The one pull-request tab, split into description, changes, comments, and CI. */
export function PullRequestView() {
  const pullRequest = useWorkspace((s) => s.pullRequest)
  const pending = useWorkspace((s) => s.pullRequestPending)
  if (pending && !pullRequest) return <div className="p-4 text-muted">Loading pull request…</div>
  if (!pullRequest) return <div className="p-4 text-muted">No pull request for this branch.</div>
  return <PullRequestBody pr={pullRequest} />
}

type PullRequestTab = 'description' | 'changes' | 'comments' | 'ci'

function PullRequestBody({ pr }: { pr: PullRequestDetail }) {
  const [tab, setTab] = useState<PullRequestTab>('description')
  const tabs: { id: PullRequestTab; label: string; count?: number }[] = [
    { id: 'description', label: 'Description' },
    { id: 'changes', label: 'Changes', count: pr.files.length },
    { id: 'comments', label: 'Comments', count: pr.comments.length },
    { id: 'ci', label: 'CI', count: pr.checks.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pull-request">
      <header data-testid="pr-header" className="shrink-0 border-b border-border px-3 pt-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">
              <span className="text-muted">#{pr.number}</span> {pr.title}
              {pr.isDraft && (
                <span
                  data-testid="pr-draft-badge"
                  className="ml-2 rounded-full border border-border px-1.5 text-[10px] text-muted"
                >
                  Draft
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {pr.author} · {pr.base} into {pr.head}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted select-text">{pr.url}</div>
          </div>
          <PullRequestHeaderActions pr={pr} />
        </div>
        <nav role="tablist" className="mt-2 -mb-px flex gap-1">
          {tabs.map((item) => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid="pr-tab"
                data-tab={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[12px] ${
                  active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
                }`}
              >
                {item.label}
                {item.count !== undefined && (
                  <span className="rounded-full bg-fg/10 px-1.5 text-[10px] leading-4">{item.count}</span>
                )}
              </button>
            )
          })}
        </nav>
      </header>
      {tab === 'description' && <DescriptionTab pr={pr} />}
      {tab === 'changes' && <ChangesTab pr={pr} />}
      {tab === 'comments' && <CommentsTab pr={pr} />}
      {tab === 'ci' && <ChecksTab pr={pr} />}
    </div>
  )
}

/** Laid out like a GitHub timeline comment. */
function CommentCard({
  author,
  verb,
  body,
  action,
}: {
  author: string
  verb: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center border-b border-border bg-panel px-4 py-2 text-[13px] text-muted">
        <span>
          <span className="font-semibold text-fg">{author}</span> {verb}
        </span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {body.trim() ? (
        <div className="p-4 select-text">
          <Markdown source={body} flavor="github" />
        </div>
      ) : (
        <p className="p-4 text-[14px] text-muted italic">No description provided.</p>
      )}
    </div>
  )
}

function DescriptionTab({ pr }: { pr: PullRequestDetail }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="pr-description">
      {editing ? (
        <DescriptionEditor pr={pr} onDone={() => setEditing(false)} />
      ) : (
        <CommentCard
          author={pr.author}
          verb="commented"
          body={pr.body}
          action={
            <button
              type="button"
              data-testid="pr-description-edit"
              onClick={() => setEditing(true)}
              className="text-[12px] text-muted hover:text-fg"
            >
              Edit
            </button>
          }
        />
      )}
    </div>
  )
}

const reviewVerb: Record<string, string> = {
  approved: 'approved these changes',
  changes_requested: 'requested changes',
  commented: 'reviewed',
  dismissed: 'left a dismissed review',
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function CommentsTab({ pr }: { pr: PullRequestDetail }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="pr-comments">
      {pr.comments.length === 0 ? (
        <p className="text-muted">No comments.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pr.comments.map((comment, index) => {
            const when = formatWhen(comment.createdAt)
            const verb = comment.review ? (reviewVerb[comment.review] ?? 'reviewed') : 'commented'
            return (
              <li key={`${comment.createdAt}:${index}`} data-testid="pr-comment" data-author={comment.author}>
                {comment.review && !comment.body.trim() ? (
                  <div className="px-1 text-[13px] text-muted">
                    <span className="font-semibold text-fg">{comment.author}</span> {verb}
                    {when && <span> · {when}</span>}
                  </div>
                ) : (
                  <CommentCard
                    author={comment.author}
                    verb={when ? `${verb} · ${when}` : verb}
                    body={comment.body}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <CommentComposer pr={pr} />
    </div>
  )
}

function ChecksTab({ pr }: { pr: PullRequestDetail }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto py-2" data-testid="pr-checks">
      {pr.checks.length === 0 ? (
        <p className="px-3 text-muted">No checks.</p>
      ) : (
        <ul>
          {pr.checks.map((check, index) => {
            const label = checkLabel(check)
            return (
              <li
                key={`${check.name}:${index}`}
                data-testid="pr-check"
                data-name={check.name}
                data-conclusion={label}
                className="flex items-center gap-2 px-3 py-1"
              >
                <span className="truncate">{check.name}</span>
                {check.url && (
                  <button
                    type="button"
                    onClick={() => void window.lookingglass.app.openExternal(check.url)}
                    className="shrink-0 text-[11px] text-muted hover:text-fg"
                  >
                    details
                  </button>
                )}
                <span className={`ml-auto shrink-0 ${conclusionClass(label)}`}>{label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ChangesTab({ pr }: { pr: PullRequestDetail }) {
  const [picked, setPicked] = useState<string | null>(null)
  const selected = pr.files.find((file) => file.path === picked) ?? pr.files[0] ?? null

  return (
    <section className="flex min-h-0 flex-1" data-testid="pr-files">
      <div className="w-56 shrink-0 overflow-auto border-r border-border py-1">
        {pr.files.length === 0 && <p className="px-3 text-muted">No files.</p>}
        {pr.files.map((file) => {
          const mark = fileMark[file.status]
          const active = selected?.path === file.path
          return (
            <button
              key={file.path}
              type="button"
              data-testid="pr-file"
              data-path={file.path}
              onClick={() => setPicked(file.path)}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-fg/5 ${active ? 'bg-fg/5' : ''}`}
            >
              <span className={`font-mono text-[10px] ${mark.className}`}>{mark.letter}</span>
              <span className="truncate">{file.path}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted">
                +{file.additions} -{file.deletions}
              </span>
            </button>
          )
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-auto" data-testid="pr-patch">
        {selected?.patch.trim() ? (
          <PatchDiff patch={selected.patch} options={diffOptions} />
        ) : (
          <div className="p-4 text-muted">
            {selected ? 'No patch for this file.' : 'No files in this pull request.'}
          </div>
        )}
      </div>
    </section>
  )
}
