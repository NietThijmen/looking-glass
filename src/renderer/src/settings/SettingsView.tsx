import { useEffect, useState, type ReactNode } from 'react'
import type { MenuCommand } from '@lookingglass/shared/ipc'
import {
  acceleratorFromEvent,
  COMMANDS,
  formatAccelerator,
  keyFor,
  type CustomAgentConfig,
  type ThemeSetting,
} from '@lookingglass/shared/settings'
import { useAgents } from '../store/agents'
import { useSettings } from '../store/settings'
import { Icon, Plus, X, iconSize } from '../ui/icon'

const isMac = navigator.userAgent.includes('Mac')

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

function ThemeSection() {
  const theme = useSettings((s) => s.settings.theme)
  const options: Array<{ value: ThemeSetting; label: string }> = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'Match the system' },
  ]
  return (
    <Section title="Theme">
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            data-testid="theme-option"
            data-value={o.value}
            aria-pressed={theme === o.value}
            onClick={() => void useSettings.getState().set({ theme: o.value })}
            className={`rounded border px-3 py-1 ${
              theme === o.value
                ? 'border-accent bg-accent/15 text-fg'
                : 'border-border text-muted hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Section>
  )
}

function KeybindingsSection() {
  const settings = useSettings((s) => s.settings)
  const [recording, setRecording] = useState<MenuCommand | null>(null)

  const save = (command: MenuCommand, key: string | undefined): void => {
    const keybindings = { ...settings.keybindings }
    const fallback = COMMANDS.find((c) => c.command === command)?.defaultKey
    if (key === undefined || key === fallback) delete keybindings[command]
    else keybindings[command] = key
    void useSettings.getState().set({ keybindings })
  }
  const clash = (command: MenuCommand, key: string): string | undefined =>
    key
      ? COMMANDS.find((c) => c.command !== command && keyFor(settings, c.command) === key)?.label
      : undefined

  return (
    <Section title="Keyboard shortcuts">
      <div className="overflow-hidden rounded border border-border">
        {COMMANDS.map((c) => {
          const key = keyFor(settings, c.command)
          const custom = c.command in settings.keybindings
          const other = clash(c.command, key)
          return (
            <div
              key={c.command}
              data-testid="keybinding"
              data-command={c.command}
              className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <span className="w-24 shrink-0 text-[11px] text-muted">{c.menu}</span>
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {other && <span className="text-[11px] text-amber-400">also used by {other}</span>}
              <button
                data-testid="keybinding-record"
                title="Click, then press the new shortcut (Esc cancels, Backspace removes it)"
                onClick={() => setRecording(c.command)}
                onBlur={() => setRecording((r) => (r === c.command ? null : r))}
                onKeyDown={(e) => {
                  if (recording !== c.command) return
                  e.preventDefault()
                  if (e.key === 'Escape') return setRecording(null)
                  if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    save(c.command, '')
                    return setRecording(null)
                  }
                  const accelerator = acceleratorFromEvent(e.nativeEvent, isMac)
                  if (!accelerator) return
                  save(c.command, accelerator)
                  setRecording(null)
                }}
                className={`min-w-28 rounded border px-2 py-0.5 text-center font-mono text-[12px] ${
                  recording === c.command ? 'border-accent text-accent' : 'border-border'
                }`}
              >
                {recording === c.command ? 'Press keys…' : formatAccelerator(key, isMac)}
              </button>
              <button
                title="Back to the default"
                disabled={!custom}
                onClick={() => save(c.command, undefined)}
                className="text-[11px] text-muted hover:text-fg disabled:invisible"
              >
                Reset
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Shortcuts that the system or another app uses may not reach Lookingglass.
      </p>
    </Section>
  )
}

interface AgentDraft {
  id: string
  label: string
  command: string
  /** One argument per line. */
  args: string
  /** KEY=value per line. */
  env: string
}

const toDraft = (a: CustomAgentConfig): AgentDraft => ({
  id: a.id,
  label: a.label,
  command: a.command,
  args: a.args.join('\n'),
  env: Object.entries(a.env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n'),
})

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

function fromDraft(d: AgentDraft): CustomAgentConfig {
  const env: Record<string, string> = {}
  for (const line of lines(d.env)) {
    const eq = line.indexOf('=')
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return { id: d.id.trim(), label: d.label.trim(), command: d.command.trim(), args: lines(d.args), env }
}

function AgentsSection() {
  const agents = useAgents((s) => s.agents)
  const builtIns = agents.filter((a) => a.builtIn)
  const [file, setFile] = useState('')
  const [drafts, setDrafts] = useState<AgentDraft[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = (): Promise<void> =>
    window.lookingglass.settings.readAgents().then((config) => {
      setFile(config.path)
      setDrafts(config.agents.map(toDraft))
      setError(config.error)
    })
  useEffect(() => {
    void load()
  }, [])

  const update = (i: number, patch: Partial<AgentDraft>): void => {
    setSaved(false)
    setDrafts((list) => list?.map((d, j) => (j === i ? { ...d, ...patch } : d)) ?? null)
  }
  const save = async (): Promise<void> => {
    if (!drafts) return
    try {
      await window.lookingglass.settings.writeAgents(drafts.map(fromDraft))
      setError(null)
      setSaved(true)
      await load()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e),
      )
    }
  }
  const field =
    'w-full rounded border border-border bg-bg px-2 py-1 outline-none select-text focus:border-accent'

  return (
    <Section title="Agents">
      <p className="mb-3 text-muted">
        Built in: {builtIns.map((a) => a.label).join(', ') || 'none'}. Add any other agent that speaks ACP
        (install it yourself, then give the command that starts it in ACP mode). Saved to{' '}
        <span className="font-mono text-[12px] select-text">{file}</span>; changes apply the next time an
        agent starts.
      </p>
      {drafts?.map((d, i) => (
        <div key={i} data-testid="custom-agent" className="mb-3 rounded border border-border p-3">
          <div className="mb-2 flex gap-2">
            <label className="flex-1">
              <div className="mb-0.5 text-[11px] text-muted">Id</div>
              <input
                data-testid="agent-id"
                className={field}
                value={d.id}
                onChange={(e) => update(i, { id: e.target.value })}
              />
            </label>
            <label className="flex-1">
              <div className="mb-0.5 text-[11px] text-muted">Name</div>
              <input
                data-testid="agent-label"
                className={field}
                value={d.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </label>
            <button
              title="Remove"
              className="self-end pb-1 text-muted hover:text-fg"
              onClick={() => {
                setSaved(false)
                setDrafts((list) => list?.filter((_, j) => j !== i) ?? null)
              }}
            >
              <Icon icon={X} className={iconSize.md} />
            </button>
          </div>
          <label className="mb-2 block">
            <div className="mb-0.5 text-[11px] text-muted">Command</div>
            <input
              data-testid="agent-command"
              className={`${field} font-mono text-[12px]`}
              placeholder="codex-acp"
              value={d.command}
              onChange={(e) => update(i, { command: e.target.value })}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex-1">
              <div className="mb-0.5 text-[11px] text-muted">Arguments (one per line)</div>
              <textarea
                rows={2}
                className={`${field} font-mono text-[12px]`}
                value={d.args}
                onChange={(e) => update(i, { args: e.target.value })}
              />
            </label>
            <label className="flex-1">
              <div className="mb-0.5 text-[11px] text-muted">Environment (KEY=value per line)</div>
              <textarea
                rows={2}
                className={`${field} font-mono text-[12px]`}
                value={d.env}
                onChange={(e) => update(i, { env: e.target.value })}
              />
            </label>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          data-testid="add-agent"
          onClick={() => {
            setSaved(false)
            setDrafts((list) => [...(list ?? []), { id: '', label: '', command: '', args: '', env: '' }])
          }}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-fg/5"
        >
          <Icon icon={Plus} className={iconSize.sm} /> Add agent
        </button>
        <button
          data-testid="save-agents"
          onClick={() => void save()}
          className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
        >
          Save agents
        </button>
        {saved && <span className="text-[12px] text-emerald-500">Saved.</span>}
        {error && <span className="text-[12px] text-red-400">{error}</span>}
      </div>
    </Section>
  )
}

export function SettingsView() {
  return (
    <div className="h-full overflow-auto" data-testid="settings">
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-lg text-fg">Settings</h1>
        <ThemeSection />
        <KeybindingsSection />
        <AgentsSection />
      </div>
    </div>
  )
}
