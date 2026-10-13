import { useEffect, useRef, useState } from 'react'
import { Chevron } from '../ui/icon'
import type { SearchMatch, SearchQuery, SearchResult } from '../../../shared/ipc'
import { basename, dirname } from '../lib/paths'
import { useEditor } from '../store/editor'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'

const DEBOUNCE_MS = 250

function Toggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean
  title: string
  onClick(): void
  children: string
}) {
  return (
    <button
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`rounded px-1 font-mono text-[11px] ${on ? 'bg-accent/30 text-fg' : 'text-muted hover:text-fg'}`}
    >
      {children}
    </button>
  )
}

function MatchLine({ match }: { match: SearchMatch }) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  match.ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(match.text.slice(cursor, start))
    parts.push(
      <mark key={i} className="rounded-sm bg-amber-400/30 text-fg">
        {match.text.slice(start, end)}
      </mark>,
    )
    cursor = end
  })
  parts.push(match.text.slice(cursor))
  return <span className="truncate font-mono text-[12px] whitespace-pre">{parts}</span>
}

export function SearchPanel() {
  const hasWorkspace = useWorkspace((s) => !!s.info)
  const focusToken = useUi((s) => s.searchFocusToken)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState<SearchQuery>({ pattern: '' })
  const [showFilters, setShowFilters] = useState(false)
  const [latest, setLatest] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  useEffect(() => {
    if (!query.pattern || !hasWorkspace) return
    let cancelled = false
    const timer = setTimeout(() => {
      setBusy(true)
      void window.lookingglass.search
        .run(query)
        .then((r) => !cancelled && setLatest(r))
        .finally(() => !cancelled && setBusy(false))
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, hasWorkspace])

  const result = query.pattern && hasWorkspace ? latest : null
  const update = (patch: Partial<SearchQuery>): void => setQuery((q) => ({ ...q, ...patch }))

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 p-2">
        <div className="flex items-center gap-1 rounded border border-border bg-bg px-2 focus-within:border-accent">
          <input
            ref={inputRef}
            data-testid="search-input"
            placeholder="Search"
            value={query.pattern}
            onChange={(e) => update({ pattern: e.target.value })}
            className="h-7 min-w-0 flex-1 bg-transparent outline-none select-text"
          />
          <Toggle
            on={query.caseSensitive === true}
            title="Match case"
            onClick={() => update({ caseSensitive: query.caseSensitive ? undefined : true })}
          >
            Aa
          </Toggle>
          <Toggle
            on={!!query.wholeWord}
            title="Whole word"
            onClick={() => update({ wholeWord: !query.wholeWord })}
          >
            ab
          </Toggle>
          <Toggle
            on={!!query.regex}
            title="Regular expression"
            onClick={() => update({ regex: !query.regex })}
          >
            .*
          </Toggle>
        </div>
        <button
          className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"
          onClick={() => setShowFilters((v) => !v)}
        >
          <Chevron open={showFilters} />
          files to include / exclude
        </button>
        {showFilters && (
          <>
            <input
              placeholder="files to include, e.g. src/**, *.ts"
              value={query.include ?? ''}
              onChange={(e) => update({ include: e.target.value })}
              className="h-7 w-full rounded border border-border bg-bg px-2 outline-none select-text focus:border-accent"
            />
            <input
              placeholder="files to exclude"
              value={query.exclude ?? ''}
              onChange={(e) => update({ exclude: e.target.value })}
              className="h-7 w-full rounded border border-border bg-bg px-2 outline-none select-text focus:border-accent"
            />
          </>
        )}
      </div>

      <div className="px-3 pb-1 text-[11px] text-muted" data-testid="search-summary">
        {busy && 'Searching…'}
        {!busy && result?.error && <span className="text-red-400">{result.error}</span>}
        {!busy &&
          result &&
          !result.error &&
          `${result.matchCount}${result.truncated ? '+' : ''} results in ${result.files.length} files`}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-4" data-testid="search-results">
        {result?.files.map((file) => (
          <div key={file.path}>
            <div
              className="flex h-[22px] cursor-default items-center gap-1.5 px-2 hover:bg-fg/5"
              onClick={() => setCollapsed((c) => ({ ...c, [file.path]: !c[file.path] }))}
            >
              <span className="flex w-3 items-center justify-center text-muted">
                <Chevron open={!collapsed[file.path]} />
              </span>
              <span className="truncate">{basename(file.path)}</span>
              <span className="truncate text-[11px] text-muted">{dirname(file.path)}</span>
              <span className="ml-auto rounded-full bg-border px-1.5 text-[10px] text-muted">
                {file.matches.length}
              </span>
            </div>
            {!collapsed[file.path] &&
              file.matches.map((match, i) => (
                <div
                  key={i}
                  data-testid="search-match"
                  onClick={() =>
                    void useEditor
                      .getState()
                      .openFile(file.path, { line: match.line, column: match.ranges[0]?.[0] ?? 0 })
                  }
                  className="flex h-[22px] cursor-default items-center gap-2 pr-2 pl-8 hover:bg-fg/5"
                >
                  <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted">
                    {match.line}
                  </span>
                  <MatchLine match={match} />
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
