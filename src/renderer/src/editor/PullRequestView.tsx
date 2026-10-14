import { PatchDiff } from '@pierre/diffs/react'
import { checkLabel, type PullRequestDetail, type PullRequestFileStatus } from '@lookingglass/shared/forge'
import { useState } from 'react'
import { Markdown } from '../agent/Markdown'
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

/** The one pull-request tab: description, checks, and a per-file patch. */
export function PullRequestView() {
  const pullRequest = useWorkspace((s) => s.pullRequest)
  const pending = useWorkspace((s) => s.pullRequestPending)
  if (pending && !pullRequest) return <div className="p-4 text-muted">Loading pull request…</div>
  if (!pullRequest) return <div className="p-4 text-muted">No pull request for this branch.</div>
  return <PullRequestBody pr={pullRequest} />
}

function PullRequestBody({ pr }: { pr: PullRequestDetail }) {
  const [picked, setPicked] = useState<string | null>(null)
  const selected = pr.files.find((file) => file.path === picked) ?? pr.files[0] ?? null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pull-request">
      <header data-testid="pr-header" className="shrink-0 border-b border-border px-3 py-2">
        <div className="truncate text-[13px]">
          <span className="text-muted">#{pr.number}</span> {pr.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {pr.author} · {pr.base} into {pr.head}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted select-text">{pr.url}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <section className="border-b border-border px-3 py-3">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Description</h2>
          {pr.body.trim() ? (
            <div data-testid="pr-description" className="select-text">
              <Markdown source={pr.body} />
            </div>
          ) : (
            <p className="text-muted">No description.</p>
          )}
        </section>
        <section className="border-b border-border py-2" data-testid="pr-checks">
          <h2 className="px-3 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Checks</h2>
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
                    className="flex items-center gap-2 px-3 py-0.5"
                  >
                    <span className="truncate">{check.name}</span>
                    <span className={`ml-auto shrink-0 ${conclusionClass(label)}`}>{label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="flex min-h-72" data-testid="pr-files">
          <div className="w-56 shrink-0 overflow-auto border-r border-border py-1">
            <h2 className="px-3 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Files</h2>
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
      </div>
    </div>
  )
}
