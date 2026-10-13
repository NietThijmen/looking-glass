# Lookingglass

> An AI-first code editor in the spirit of Cursor, built on Electron. The difference: **it ships no agent of its own.** It speaks the [Agent Client Protocol (ACP)](https://agentclientprotocol.com), so you can use the agent you already pay for (Claude Code, Codex, or anything else that speaks ACP) inside a full editor.

**Status:** Phases 0–6 are done: skeleton, editor shell, ACP chat, Cursor-style editing, browser and element picker, multi-agent, and polish. Only the "later / maybe" items are open. See the [Roadmap](#roadmap).

---

## Why

Cursor's editor UX is very good: chat beside the code, agent edits shown as reviewable diffs, inline edits, a terminal the agent can drive, and a built-in browser where you can point at an element and ask about it. But the agent is locked to Cursor's own backend and billing.

Meanwhile the best coding agents are CLIs (Claude Code, Codex) whose subscriptions people already have. ACP is a JSON-RPC protocol between an **editor (the client)** and an **agent (a subprocess)**. It already has adapters for those CLIs.

Lookingglass is the client: the editor shell and UX, with the agent swappable per session.

|                                   | Cursor            | Lookingglass                                                                    |
| --------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| Editor                            | VS Code fork      | Electron + `@pierre/diffs`                                                      |
| Agent                             | Cursor's built-in | Any ACP agent (Claude Code, Codex, Gemini CLI, custom)                          |
| Auth / billing                    | Cursor account    | Each agent's own login and subscription                                         |
| Model choice                      | Cursor's menu     | Whatever the agent supports                                                     |
| Built-in browser + element picker | Yes               | Yes. Any agent can use it, via MCP (see [Browser](#browser-and-element-picker)) |

---

## Goals

1. **Agent-agnostic.** Every agent integration goes through ACP. The UI has no Claude- or Codex-specific code paths. Agent differences are expressed only through ACP capabilities.
2. **Cursor-grade agent UX.** Streaming chat, visible tool calls, plans, per-hunk accept/reject of agent edits, and a terminal the agent can use while you watch.
3. **A browser in the editor.** Preview your app in a tab, pick any element and ask the agent about it or to change it. The agent can drive the same browser to check its own work.
4. **A real editor.** Opening a folder, a file tree, tabs, an editor with syntax highlighting, search, git status, and an integrated terminal. You should be able to work without the agent.
5. **Safe by default.** Agents run as separate processes. File writes and commands go through the client where possible, so we can show diffs and ask permission.

## Non-goals for v1

- **VS Code extension compatibility.** We use `@pierre/diffs`, not a VS Code fork.
- **Hosting models or proxying API keys.** Agents bring their own auth.
- **Multi-root workspaces, remote/SSH workspaces, collaboration.** Maybe later.

---

## What ACP gives us

ACP is JSON-RPC 2.0 over the agent subprocess's stdio. The editor spawns the agent and the two sides call each other.

**Client → Agent**

| Method                         | Used for                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `initialize`                   | Negotiate protocol version and capabilities (we advertise `fs` and `terminal` support) |
| `authenticate`                 | Trigger the agent's login flow if it says it needs one                                 |
| `session/new` / `session/load` | Start or resume a conversation, passing `cwd` and MCP servers                          |
| `session/prompt`               | Send a user turn (text plus embedded resources: files, selections, images)             |
| `session/cancel`               | Stop button                                                                            |
| `session/set_mode`             | Agent modes such as "ask", "plan" or "auto-accept edits", when the agent offers them   |

**Agent → Client**

| Method                                                                                              | Used for                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `session/update` (notification)                                                                     | Streaming message chunks, thoughts, tool calls and their status, plans, diffs, mode changes                       |
| `session/request_permission`                                                                        | "Allow this edit / command?" prompts                                                                              |
| `fs/read_text_file`                                                                                 | Agent reads a file. **We serve unsaved editor buffers**, so the agent sees what you see.                          |
| `fs/write_text_file`                                                                                | Agent writes a file. **We turn this into a pending diff** in the editor instead of writing to disk straight away. |
| `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release` | Agent runs commands in a terminal we own and render                                                               |

The `fs/*` and `terminal/*` methods are what make a Cursor-like UX possible. The agent's edits and commands go through the editor, not around it.

> ⚠️ **Verify per agent:** not every adapter routes all edits through `fs/write_text_file`. Some may write to disk with their own tools. The plan must handle both cases (see [Edit review](#edit-review-the-core-ux)).

---

## Supported agents

| Agent                                                 | How it connects                                                                            | Notes                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Claude Code**                                       | `@agentclientprotocol/claude-agent-acp` (wraps the Claude Agent SDK), bundled with the app | Uses the user's existing `claude` login or `ANTHROPIC_API_KEY` |
| **Any other ACP agent** (Codex, Gemini CLI, your own) | The user installs the agent or its ACP adapter and adds the command to `agents.json`       | Uses that agent's own login                                    |

Claude Code is built in: the adapter (and the Claude CLI binary it ships) is a pinned dependency, run with Electron's own Node, so users don't need Node installed. Lookingglass doesn't bundle, download or special-case any other agent. Install the agent or its ACP adapter yourself (for example `codex-acp` for Codex, or Gemini CLI's ACP mode), then add it to `~/.lookingglass/agents.json` (a built-in id can't be overridden). Check the agent's own docs for the current command and flags:

```jsonc
// ~/.lookingglass/agents.json
{
  "codex": {
    "label": "Codex",
    "command": "codex-acp",
    "args": [],
  },
  "my-agent": {
    "label": "My Agent",
    "command": "/usr/local/bin/my-agent",
    "args": ["--acp"],
  },
}
```

---

## Architecture

```
┌──────────────────────────── Electron ─────────────────────────────┐
│                                                                   │
│  Renderer (React, sandboxed, contextIsolation)                    │
│  ┌───────────┬──────────────────────────────┬──────────────────┐  │
│  │ File tree │  @pierre/diffs editor + diffs│  Agent panel     │  │
│  │ Search    │  Tabs, pending-edit overlays │  chat, tool calls│  │
│  │ Git       │  Browser tabs + el. picker   │  plans, perms    │  │
│  │           ├──────────────────────────────┤  agent picker    │  │
│  │           │  Terminals (ghostty-web)     │                  │  │
│  └───────────┴──────────────────────────────┴──────────────────┘  │
│                    ▲  typed IPC via preload (contextBridge)       │
│                    ▼                                              │
│  Main process                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ AgentManager ── one AcpClient per running agent process     │  │
│  │   └─ SessionStore (sessions, history, pending edits)        │  │
│  │ WorkspaceService ── fs access confined to workspace root    │  │
│  │   ├─ BufferRegistry (unsaved editor contents, from renderer)│  │
│  │   ├─ FileWatcher (@parcel/watcher)                          │  │
│  │   ├─ Search (ripgrep)                                       │  │
│  │   └─ Git (status, diff, stage; via git CLI)                 │  │
│  │ TerminalService ── node-pty; shared by user and agents      │  │
│  │ BrowserService ── WebContentsViews, element picker, CDP     │  │
│  │ PermissionService ── policies + prompts the renderer        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│            │ stdio (JSON-RPC / ACP)                               │
└────────────┼──────────────────────────────────────────────────────┘
             ▼
   ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
   │ claude-code ACP  │  │  codex-acp   │  │  gemini CLI  │  ...
   │   adapter        │  │              │  │ (native ACP) │
   └──────────────────┘  └──────────────┘  └──────────────┘
```

### Key components

**AcpClient** (main): wraps the official ACP TypeScript SDK. It owns one child process and implements the client-side handlers (`fs/*`, `terminal/*`, `session/request_permission`). It turns `session/update` notifications into typed events for the renderer. It restarts crashed agents and shows their stderr in a log panel.

**AgentManager** (main): reads the agent registry, spawns agents lazily, and maps `sessionId` to agent. Several agents can run at the same time, for example Claude Code in one chat tab and Codex in another, on the same workspace.

**WorkspaceService** (main): the single gate for file access. Every path from an agent is resolved and checked to be inside the workspace root before anything is read or written. Reads prefer the `BufferRegistry` (unsaved edits) over disk.

**TerminalService** (main): `node-pty` sessions. Agent-created terminals show up in the terminal panel labelled with the agent's name, so you can watch them and kill them.

**BrowserService** (main): owns the embedded browser tabs (Electron `WebContentsView`s in their own session partition). It runs the element picker, collects console and network logs over the Chrome DevTools Protocol, and serves the `browser_*` MCP tools that agents use. See [Browser and element picker](#browser-and-element-picker).

**PermissionService** (main): answers `session/request_permission` from policy ("always allow reads", "ask for writes", "always ask for commands", per-workspace allowlists), or forwards the request to the renderer as a prompt.

**Renderer**: React with [`@pierre/diffs`](#editor-pierrediffs) for both the code editor and every diff view. State lives in a small store (Zustand) fed by IPC events. The renderer never touches Node or the filesystem directly.

---

### Editor: `@pierre/diffs`

The editor and all diff views use [`@pierre/diffs`](https://diffs.com), a Shiki-based library for rendering and editing code and diffs, rather than Monaco. One library and one look for reading code, editing it, and reviewing agent changes.

| Need                                                    | `@pierre/diffs` piece                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code editor tab                                         | `File` made editable with `EditProvider` / `Editor` (piece-table document, undo stack, find panel, bracket matching, comment toggling, custom keymaps) |
| Reviewing one agent edit                                | `FileDiff` (split or stacked) with built-in accept/reject hunk actions. It's editable too, so you can tweak the agent's change before accepting.       |
| "Changes" list for a whole turn                         | `MultiFileDiff` / `CodeView` with virtualization, so large turns stay fast                                                                             |
| Git diff view, patches from agents                      | `PatchDiff` (renders unified diffs directly)                                                                                                           |
| Merge conflicts                                         | `UnresolvedFile` with current / incoming / both resolution                                                                                             |
| Diagnostics squiggles                                   | Editor `Marker`s with severities                                                                                                                       |
| Inline comments, "Ask about this", agent notes on lines | The line-annotation framework                                                                                                                          |
| Cmd+K inline edit trigger                               | The selection-action popover (`enabledSelectionAction`)                                                                                                |
| Smooth highlighting on big files                        | The worker pool (`WorkerPoolContextProvider`). Our CSP already allows `worker-src 'self' blob:`.                                                       |

**Trade-off vs. Monaco:** no built-in IntelliSense. The LSP bridge (Phase 6) adds diagnostics only; hover, go-to-definition and completions are out of scope for v1. For an agent-first editor that's acceptable, but it's the main thing we give up. See open question 5.

## Edit review (the core UX)

This is the feature that makes it feel like Cursor rather than a terminal in a window.

**Agent edits are applied to disk right away and reviewed afterwards.** Keeping edits pending would mean the agent's own `pnpm test` or build sees the old files, so we chose apply-then-review (see open question 2).

1. Before every prompt, Lookingglass takes a **checkpoint**: a snapshot of the work tree in a private "shadow" git repository under the app's data folder. It has its own git dir and index, uses the workspace as its work tree, honours `.gitignore`, skips `node_modules` and similar folders, and never touches the project's own `.git`. It works in folders that aren't git repos.
2. The agent edits files, either through ACP `fs/write_text_file` or with its own tools. Both end up on disk.
3. While the turn runs, and again when it ends, files that differ from the turn's checkpoint join the **review set**, with the checkpoint contents as their baseline. ACP writes are recorded directly too. A file keeps its first baseline across turns until you decide.
4. The renderer shows the changes:
   - a **changes bar** above the chat input with Keep all / Undo all and a per-file list,
   - a **review tab** per file (`@pierre/diffs` `MultiFileDiff`) with **Keep / Undo on every hunk**,
   - a banner on open editor tabs for changed files, and ✦ marks in the file tree.
5. **Keep** moves the baseline to the current contents. **Undo** writes the baseline back (or deletes a file the agent created). Per-hunk decisions do the same for one hunk. A file drops out of review once it matches its baseline.

Open editor tabs follow agent writes: ACP writes reload the buffer (the agent already read the unsaved contents), other changes reload a clean buffer or show the conflict banner.

### Checkpoints

Every user message in the chat keeps the checkpoint taken before it. **Restore** (hover the message) puts every file changed since then back the way it was, including deleting files created since.

---

## Context and prompting

Prompts sent with `session/prompt` are built from ACP content blocks:

- **@-mentions**: `@file`, `@folder`, `@selection`, `@terminal`, `@git-diff`, `@problems`, `@browser` (current page screenshot and URL) and `@browser-console` become `resource` / `resource_link` blocks. We only send what the agent's `promptCapabilities` from `initialize` says it accepts. Otherwise we fall back to inlined text.
- **Images**: pasted or dropped into chat, sent as image blocks when supported.
- **Picked elements**: from the browser's element picker (see [Browser and element picker](#browser-and-element-picker)).
- **Active editor context** (optional, on by default): the current file and selection are attached automatically.

### Inline edit (Cmd+K)

1. The user selects code (or leaves the caret on a line) and presses Cmd+K, then types an instruction in the box over the editor.
2. The file is saved, and a new chat on the default agent gets the instruction, the code as a resource, and a preface asking it to change only those lines. The chat is visible, so the edit can be watched or stopped like any other turn.
3. The agent's write lands in review like any agent edit, and the file's review tab opens when the turn ends.

This is slower than Cursor's purpose-built inline model because it goes through a full agent turn. That's acceptable for v1, and fast-model agent settings can help.

### Editor tools via MCP

`session/new` accepts a list of MCP servers. Lookingglass runs a small **built-in MCP server** and passes it to every session, so any agent gets editor-aware tools without per-agent work:

- `get_diagnostics`: errors and warnings from the language server, for one file (opened on demand) or the files open in the editor
- `get_open_editors`: open tabs and the active selection
- `open_file`: reveal a file or line in the editor
- `get_git_status`
- `browser_*`: see [Agent-controlled browser](#agent-controlled-browser-mcp-tools)

Projects can add their own MCP servers in `.lookingglass/settings.json`, in the shape most agents use. They're passed to every new or resumed session alongside the built-in one (HTTP/SSE servers only to agents that support them):

```jsonc
// <workspace>/.lookingglass/settings.json
{
  "mcpServers": {
    "db": { "command": "npx", "args": ["my-db-mcp"], "env": { "DB_URL": "postgres://…" } },
    "docs": { "type": "http", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } },
  },
}
```

Because agents start these servers themselves, the first session in a folder asks whether to allow the listed servers. The answer is remembered for that exact list; changing the list asks again.

---

## Browser and element picker

A browser built into the editor, where you can point at something on the page and ask about it. The flow: run your dev server, open it in a browser tab next to your code, click an element, and ask "why is this misaligned?" or "make this button match the primary style". The agent gets the element's HTML, styles, a screenshot and, where possible, the source file and line that rendered it. The agent can also drive the same browser itself to check its work after editing.

```
┌──────────┬───────────────────────────────────────┬─────────────────────┐
│ EXPLORER │ app.ts │ 🌐 localhost:5173 ●            │ Chat 1 · Claude Code│
│          │ ◀ ▶ ⟳  http://localhost:5173/  [⌖][📱]│─────────────────────│
│          │ ┌───────────────────────────────────┐ │ ┌─────────────────┐ │
│          │ │  My App            Login  Signup  │ │ │⌖ button.cta     │ │
│          │ │                    ┏━━━━━━━━━━━┓  │ │ │  Hero.tsx:42  ✕ │ │
│          │ │  Welcome back      ┃ Get started┃◀─┼─┼─│ 160×44 · 📷     │ │
│          │ │                    ┗━━━━━━━━━━━┛  │ │ └─────────────────┘ │
│          │ │    ┌ button.cta  160×44 ────────┐ │ │ why is this not     │
│          │ │    │ Ask about this element…   ⏎│ │ │ vertically centered │
│          │ │    └────────────────────────────┘ │ │ with the heading?   │
│          │ └───────────────────────────────────┘ │                     │
│          │ CONSOLE  ⚠ 1  ✖ 2                      │                     │
└──────────┴───────────────────────────────────────┴─────────────────────┘
```

### Browser tabs

- A browser tab opens in the editor area like any file tab, so it can sit in a split next to code.
- Each tab is an Electron **`WebContentsView`** owned by the main process. We don't use the `<webview>` tag, which Electron discourages. The renderer draws a placeholder and reports its size and position, and the main process keeps the view's bounds in sync.
- All browser tabs share their own **session partition** (`persist:lookingglass-browser`), separate from the app's UI session. Your test logins persist between restarts but never mix with the app.
- Includes an address bar, back/forward/reload, a **device size toolbar** (phone, tablet, desktop presets plus custom sizes) and a button that opens Chromium DevTools for the tab.
- **Dev server detection:** the TerminalService watches terminal output for URLs like `Local: http://localhost:5173` and offers "Open in browser". Projects can also set a default preview URL in `.lookingglass/settings.json`.
- **Console panel** under the browser: console messages, uncaught exceptions and failed network requests for that tab, captured over CDP (see below). Any entry can be sent to chat with "Add to chat", and `@browser-console` attaches recent errors.

> Known Electron quirk: a `WebContentsView` is drawn _above_ the renderer, so app popovers (menus, command palette, modals) can't overlap it. When one opens over the browser, we temporarily swap the view for a screenshot of itself, then restore it.

### The element picker

**Turning it on:** click the ⌖ button in the browser toolbar, or press `Cmd+Shift+C` while the browser has focus. Then:

1. Hovering highlights elements with a box-model overlay (margin, border, padding, content) and a label showing tag, classes and size, like DevTools.
2. Clicking selects the element. **Shift+click** adds more elements. **Alt+scroll** or the arrow keys walk to the parent or child, for when the thing you want is a wrapper.
3. A small **"Ask about this element…" input** pops up next to the selection:
   - `Enter` sends the question to the active chat.
   - `Cmd+Enter` starts a new chat with the default agent.
   - `Esc` just adds the element to the chat input as a chip, so you can keep typing there or pick more.
4. Dragging on empty space captures a **region screenshot** instead, for "what's wrong with this area?" questions that aren't about one element.

**How it's implemented:** with the **Chrome DevTools Protocol**, through Electron's `webContents.debugger`, rather than a script injected into the page:

- `Overlay.setInspectMode({ mode: "searchForNode" })` provides the same hover highlight as DevTools. It works inside iframes and shadow DOM, isn't affected by the page's CSS or CSP, and the page can't detect or break it. When the user clicks, we receive `Overlay.inspectNodeRequested` with the node's `backendNodeId`.
- From that ID we collect the context below with `DOM.*`, `CSS.*`, `Page.captureScreenshot` and `Accessibility.*` calls.
- An injected-script picker, running in an **isolated world** via `executeJavaScriptInIsolatedWorld`, is the fallback for anything CDP can't do, such as the floating question input. This doesn't need to be added to the page's own code.

### What gets sent to the agent

When an element is attached, the chip turns into these ACP content blocks in `session/prompt`:

| Block            | Contents                                                                                                                                                            | Source                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `text` (summary) | Page URL and title, a unique CSS selector, tag/id/classes, visible text, size and position, viewport size, and the element's **accessible name and role**           | `DOM.describeNode`, `DOM.getBoxModel`, `Accessibility.getPartialAXTree`, plus a selector generated in the page |
| `text` (markup)  | `outerHTML`, trimmed to a budget (about 4 KB) with long children collapsed, plus the outline of its parent chain                                                    | `DOM.getOuterHTML`                                                                                             |
| `text` (styles)  | The **matched CSS rules** with their stylesheet and line number, plus a filtered set of computed styles (layout, box model, typography, colours; defaults left out) | `CSS.getMatchedStylesForNode`, `CSS.getComputedStyleForNode`                                                   |
| `image`          | A screenshot of the element with some padding around it, highlight drawn on                                                                                         | `Page.captureScreenshot` with `clip`                                                                           |
| `resource_link`  | **The source file and line that rendered it**, when we can work it out (see below)                                                                                  | Source resolver                                                                                                |
| `text` (console) | Recent errors from the page, if the user ticks "include console"                                                                                                    | Console capture                                                                                                |

We only send block types the agent's `promptCapabilities` allows. If images aren't supported, we leave out the screenshot and say so in the summary text. Each chip shows exactly what will be sent, and you can untick parts before sending.

### Mapping elements back to source

This is what makes the picker feel magic: "this button" turns into `src/components/Hero.tsx:42`. We try these in order and show the result in the chip, where you can click it to open the file:

1. **Framework dev metadata**, read in the page's isolated world:
   - **React**: the owner component name, and its source location when the build includes it. Older dev builds expose `_debugSource` on the fiber. Newer React versions removed it, so for those we fall back to the options below.
   - **Vue**: `__vueParentComponent.type.__file`
   - **Svelte**: `__svelte_meta.loc`
   - **Angular**: `ng.getComponent()` for the component name
2. **`data-lg-source` attributes**: if a project's own build tooling adds `data-lg-source="src/Hero.tsx:42:7"` to elements, we read it as an exact location.
3. **Stylesheet source maps**: the matched CSS rules from CDP come with stylesheet URLs and lines, which we map through source maps to `.css`/`.scss`/`.module.css` files in the workspace. This tells the agent where the styles live, even when the markup source is unknown.
4. **Search heuristic**: ripgrep the workspace for distinctive class names, `id`s, `data-testid`s or text content, and attach the best few matches marked as _guesses_.

All resolved paths go through WorkspaceService confinement. We never link to files outside the workspace.

### Agent-controlled browser (MCP tools)

The built-in MCP server (see [Editor tools via MCP](#editor-tools-via-mcp)) also exposes browser tools, so **any** ACP agent can use the browser without agent-specific code. The design borrows from Playwright MCP: the agent works from an accessibility snapshot with element refs, not pixel coordinates.

| Tool                                                                                        | Does                                                                      | Permission                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `browser_list_tabs`                                                                         | Open tabs, with URL and title                                             | none                                                                          |
| `browser_get_selection`                                                                     | The element(s) the user currently has picked, with the full context above | none                                                                          |
| `browser_snapshot`                                                                          | Accessibility tree of the page, with `ref`s the other tools can target    | none                                                                          |
| `browser_screenshot`                                                                        | Full page, viewport or one element (`ref`)                                | none                                                                          |
| `browser_console` / `browser_network_errors`                                                | Recent console output and failed requests                                 | none                                                                          |
| `browser_navigate`                                                                          | Open a URL in a tab                                                       | free on `localhost` and the configured preview URL; **ask** for other origins |
| `browser_click` / `browser_type` / `browser_hover` / `browser_press_key` / `browser_resize` | Interact with the page                                                    | policy (default: allow on localhost)                                          |
| `browser_evaluate`                                                                          | Run JavaScript in the page                                                | **always ask** by default                                                     |

While an agent is driving a tab, the tab shows an **"Agent is using this tab"** banner with a **Stop** button. Each action also shows in the chat as a tool-call card with a thumbnail screenshot. This closes the loop: the agent edits `Hero.tsx`, HMR reloads, and the agent takes a screenshot to check the fix.

### Browser security

- Browser tabs have no preload with Node access and no access to the app's IPC. Pages are treated as untrusted web content.
- `window.open`, downloads and permission requests (camera, mic, location, notifications) are denied by default and can be allowed per origin.
- **Privacy:** picker context and screenshots go to whichever agent (and so whichever model provider) the chat uses. Pages you're logged into can contain personal data, so the chip preview shows exactly what will be sent.
- `browser_evaluate` and navigation to other origins need permission, because cookies in the browser partition mean an agent could act as you on real sites.

---

## UI layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◧ lookingglass — ~/code/my-app                [Claude Code ▾] [⚙]     │
├──────────┬───────────────────────────────────────┬─────────────────────┤
│ EXPLORER │ app.ts ● │ api.ts │ +2 pending ●        │ Chat 1 · Claude Code│
│ ▸ src    │───────────────────────────────────────│ Chat 2 · Codex      │
│   app.ts │  12  export function handler() {     │─────────────────────│
│ ● api.ts │- 13    return fetch(url)               │ you: add retries to │
│   ...    │+ 13    return withRetry(() =>          │      @api.ts        │
│          │+ 14      fetch(url), { tries: 3 })     │                     │
│          │        [✓ Accept] [✗ Reject]           │ ▸ Read api.ts       │
│ SEARCH   │                                       │ ▸ Edit api.ts  (+2) │
│ GIT      │───────────────────────────────────────│ ▸ Run `pnpm test` ✓ │
│          │ TERMINAL  zsh │ Claude: pnpm test     │                     │
│          │ ✓ 42 passed                           │ Changes (1 file)    │
│          │                                       │ [Accept all][Reject]│
│          │                                       │ ┌─────────────────┐ │
│          │                                       │ │ Ask anything… @ │ │
│          │                                       │ └─────────────────┘ │
└──────────┴───────────────────────────────────────┴─────────────────────┘
```

- **Agent picker** per chat tab. A chat is bound to one agent for its whole life, because ACP sessions can't move between agents.
- **Tool calls** render as collapsible cards with kind, status and content (diffs, terminal output, locations you can click to jump to).
- **Plans** (`session/update` plan entries) show as a live checklist at the top of the turn.
- **Modes**: if the agent reports modes, show a mode dropdown next to the input (for example Claude Code's plan mode).
- **Session history**: a list of past chats per workspace, resumed with `session/load` when the agent supports it, or read-only otherwise.

---

## Tech stack

| Concern               | Choice                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager       | pnpm (already configured)                                                                                                                                                                |
| Shell                 | Electron (latest stable), `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`                                                                                                |
| Build                 | electron-vite (main, preload and renderer in one config)                                                                                                                                 |
| Packaging             | electron-builder (dmg / nsis / AppImage), with auto-update later                                                                                                                         |
| UI                    | React, TypeScript, Tailwind                                                                                                                                                              |
| Editor                | `@pierre/diffs` (Shiki-based): editable `File` for code, `FileDiff` / `MultiFileDiff` for reviews                                                                                        |
| Terminal              | [`ghostty-web`](https://github.com/coder/ghostty-web) (Ghostty's VT parser as WASM, xterm.js-compatible API) + `node-pty`                                                                |
| Browser               | Electron `WebContentsView` + Chrome DevTools Protocol via `webContents.debugger`; `source-map-js` for stylesheet mapping                                                                 |
| ACP                   | Official ACP TypeScript SDK                                                                                                                                                              |
| MCP (built-in server) | `@modelcontextprotocol/sdk`                                                                                                                                                              |
| File watching         | `@parcel/watcher`                                                                                                                                                                        |
| Search                | bundled ripgrep (`@vscode/ripgrep`)                                                                                                                                                      |
| Git                   | `git` CLI via `execa` (simpler and more faithful than a JS reimplementation)                                                                                                             |
| Chat markdown         | `@tanstack/markdown` (React renderer, streaming profile while a reply is arriving, safe defaults: no raw HTML). Code fences are highlighted by `@pierre/diffs`, not the markdown library |
| State                 | Zustand (renderer), plain classes + an event emitter (main)                                                                                                                              |
| Persistence           | JSON files under `~/.lookingglass/` and `<workspace>/.lookingglass/` at first; SQLite (`better-sqlite3`) if session history gets heavy                                                   |
| Tests                 | Vitest (unit), Playwright for Electron (e2e), plus a **fake ACP agent** for deterministic tests                                                                                          |

---

## Proposed repo layout

```
lookingglass/
├── package.json
├── electron.vite.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts                 # app lifecycle, windows
│   │   ├── ipc/                     # typed IPC handlers (one file per domain)
│   │   ├── acp/
│   │   │   ├── AcpClient.ts         # one agent process + client handlers
│   │   │   ├── AgentManager.ts
│   │   │   ├── registry.ts          # built-in + user agent definitions
│   │   │   └── handlers/            # fs.ts, terminal.ts, permission.ts
│   │   ├── workspace/
│   │   │   ├── WorkspaceService.ts  # path confinement, read/write
│   │   │   ├── BufferRegistry.ts
│   │   │   ├── PendingEdits.ts
│   │   │   ├── Checkpoints.ts
│   │   │   ├── watcher.ts
│   │   │   ├── search.ts
│   │   │   └── git.ts
│   │   ├── terminal/TerminalService.ts
│   │   ├── browser/
│   │   │   ├── BrowserService.ts    # WebContentsViews, partitions, bounds sync
│   │   │   ├── cdp.ts               # typed wrapper around webContents.debugger
│   │   │   ├── picker.ts            # inspect mode, multi-select, context collection
│   │   │   ├── sourceResolver.ts    # framework metadata, data-lg-source, source maps, rg
│   │   │   ├── capture.ts           # console, exceptions, network errors
│   │   │   └── isolated/            # scripts run in the page's isolated world
│   │   ├── permissions/PermissionService.ts
│   │   └── mcp/editorMcpServer.ts   # built-in MCP tools for agents (editor + browser_*)
│   ├── preload/
│   │   └── index.ts                 # contextBridge API, the only renderer↔main surface
│   ├── renderer/                    # index.html, code lives in renderer/src/
│   │   ├── App.tsx
│   │   ├── editor/                  # @pierre/diffs setup, tabs, diff + review views
│   │   ├── agent/                   # chat panel, tool-call cards, plan, input w/ @-mentions
│   │   ├── browser/                 # browser tab chrome, device toolbar, console panel, element chips
│   │   ├── explorer/  search/  git/  terminal/  settings/
│   │   └── store/
│   └── shared/
│       └── ipc-types.ts             # IPC contract shared by main, preload and renderer
├── packages/
│   └── fake-agent/                  # scriptable ACP agent for tests
└── e2e/
```

---

## Security model

- Agents are **untrusted subprocesses**. They get a `cwd` and an environment we control. They have no access to Electron.
- Every `fs/*` path is normalized, symlinks are resolved, and the path must be inside the workspace root. Otherwise the request is rejected.
- Writes go through pending edits by default. Commands go through `terminal/*` and need permission according to policy.
- The renderer is sandboxed. The preload exposes a narrow, typed API, with no generic `invoke(channel, ...)` passthrough.
- No secrets are stored by Lookingglass. Agent auth stays in each agent's own config (`~/.claude`, `~/.codex`, and so on).
- A workspace's own MCP servers (`.lookingglass/settings.json`) are only passed to agents after the user allows that exact list for that folder, so opening a cloned repo can't make an agent start its commands.
- Browser tabs are isolated from the app and from agents except through the permissioned `browser_*` tools. See [Browser security](#browser-security).
- **Caveat:** an agent that executes commands with its _own_ tools (not `terminal/*`) runs with the user's privileges, the same as running the CLI directly. The UI should make it clear when an agent is in a "bypass permissions" style mode.

---

## Roadmap

### Phase 0: Skeleton

- [x] electron-vite + React + TypeScript scaffold, with lint, format and Vitest
- [x] Secure window setup, typed preload/IPC contract
- [x] Packaging smoke test on macOS

### Phase 1: Editor shell (no AI)

- [x] Open folder, file tree, tabs, `@pierre/diffs` editor with save, dirty state and file watching
- [x] Integrated terminal (node-pty + ghostty-web)
- [x] Ripgrep search panel
- [x] Git status decorations and a basic diff view

### Phase 2: ACP chat

- [x] AcpClient + AgentManager, with the Claude Code adapter as the first target
- [x] Skeleton of the built-in MCP server, passed in `session/new` (the browser tools in Phase 4 build on it)
- [x] `initialize` / `authenticate` / `session/new` / `session/prompt` / `session/cancel`
- [x] Streaming chat rendering: messages, thoughts, tool-call cards, plans
- [x] `fs/read_text_file` served from editor buffers
- [x] `session/request_permission` UI + PermissionService policies (reads, searches and thinking auto-approved; everything else asks)
- [x] Fake ACP agent + e2e tests

### Phase 3: Cursor-style editing

- [x] Agent edits reviewed against a baseline, with per-hunk keep/undo (apply-then-review, see [Edit review](#edit-review-the-core-ux))
- [x] Changes list in the agent panel, Keep all / Undo all
- [x] Per-turn checkpoints and "restore to before this message"
- [x] Diffing for agents that write to disk directly (the same checkpoint mechanism)
- [x] `terminal/*` handlers with agent terminals visible in the panel
- [x] @-mentions (files, folders, selection, terminal, git diff, `@browser`, `@browser-console`) and pasted/dropped images. `@problems` (open files' diagnostics, from the LSP bridge)

### Phase 4: Browser and element picker

- [x] Browser tab (`WebContentsView`, own partition, bounds sync, address bar, device sizes, DevTools button)
- [x] Dev server URL detection from terminal output (plus `previewUrl` in `.lookingglass/settings.json`)
- [x] CDP wrapper; console, exception and network error capture with a console panel
- [x] Element picker: inspect-mode overlay, Shift+multi-select, parent/child walking (buttons and ↑/↓ in the ask box), drag-to-region screenshot
- [x] Context collection (summary, trimmed markup, matched rules + computed styles, element screenshot) as ACP content blocks, with a chip preview and toggles
- [x] "Ask about this element…" popover → active chat / new chat
- [x] Source resolution: React/Vue/Svelte metadata, stylesheet source maps, ripgrep guesses (reads `data-lg-source` when present)
- [x] `browser_*` MCP tools with permission policies, "Agent is using this tab" banner and Stop

### Phase 5: Multi-agent

- [x] Other agents via `~/.lookingglass/agents.json` (users install them; nothing agent-specific in Lookingglass)
- [x] Agent registry UI for adding and editing `agents.json` entries (Settings → Agents)
- [x] Several chats with different agents running at once (new-chat picker; each chat keeps its agent for life)
- [x] Session history (`session/list`) and resuming with `session/load`, including picking a chat back up after its agent stopped (history stays with each agent, see open question 3)
- [x] Mode switching (`session/set_mode`) when the agent reports modes

### Phase 6: Polish

- [x] Cmd+K inline edit (Agent menu, runs as its own chat, result opens in review)
- [x] Remaining built-in editor MCP tools: `get_diagnostics` (open editors and reveal were already there as `get_open_editors` / `open_file`)
- [x] Per-workspace user MCP servers (`.lookingglass/settings.json`, allowed per folder)
- [x] LSP bridge (main process ↔ language servers) feeding diagnostics into editor markers, starting with TypeScript
- [x] Settings UI (⌘, or the gear in the activity bar): dark / light / system theme, rebindable menu shortcuts, custom agents
- [x] Auto-update (electron-updater from GitHub releases), code signing and notarization config. The first signed release still needs a Developer ID certificate and Apple credentials, see [Releasing](#releasing)

### Later / maybe

- [ ] Background agents in git worktrees (one worktree per chat, merge back)
- [ ] Remote workspaces

---

## Open questions

1. **Edit interception coverage.** _Partly answered._ With `terminal: true` advertised, Claude Code (adapter 0.89) still ran a shell command with its own tool rather than `terminal/*`. Because review is checkpoint-based, file edits are caught however they are written, whichever agent the user adds. Shell commands run by an agent's own tool don't show up in our terminal panel.
2. **Pending edits vs. agent self-verification.** _Decided:_ edits apply to disk during the turn and are reviewed afterwards against the checkpoint, so the agent's own tests see its changes.
3. **Session portability.** _Decided:_ history stays with each agent and is resumed with `session/load`. We don't keep our own transcript to move a conversation between agents.
4. **Bundling adapters.** _Decided:_ only Claude Code is bundled. Users install any other agent or adapter themselves and point `agents.json` at it.
5. **Language intelligence.** `@pierre/diffs` has no built-in language services (Monaco shipped TS/JS IntelliSense). Everything (diagnostics, hover, go-to-definition, completions) would come from an LSP bridge. _Decided for v1:_ diagnostics only (TypeScript first), shown as editor markers and feeding `@problems` and the diagnostics MCP tool. Agents bring their own tools for code understanding.
6. **Source mapping on modern React.** Newer React versions removed `_debugSource`, so precise file:line for React apps would have to come from React's owner stacks plus source maps. Until then it falls back to stylesheet source maps and search guesses. (We decided against shipping a dev plugin.)
7. **Shared vs. per-workspace browser profile.** _Decided:_ one shared partition (`persist:lookingglass-browser`), so logins carry over between projects.
8. **Name.** "Lookingglass" for now.

---

## Development

Requires Node 24+ and pnpm 11.

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm check        # typecheck + lint + prettier + unit tests
pnpm smoke        # build, then drive the real app against a throwaway git fixture
pnpm package:dir  # unpacked app in release/<version>/ (fast packaging check)
pnpm smoke:packaged  # the same smoke run against the packaged macOS app
pnpm package      # installers for the current platform (unsigned for now)
```

`scripts/smoke.mjs` creates a temporary git repo, launches the app with `LOOKINGGLASS_SMOKE=1` and `LOOKINGGLASS_WORKSPACE` pointing at it, and the app runs the checks in `src/main/smoke.ts`: explorer, opening and typing in a file, saving, search, git status and diff, the file watcher, path-traversal refusal, and a real shell in the terminal. Set `SCREENSHOT=out.png` to also save a screenshot. The window is shown during the run because typed input needs a focused window.

`LOOKINGGLASS_WORKSPACE=/some/folder pnpm dev` opens a specific folder; otherwise the app reopens the last one.

### Releasing

```bash
pnpm release      # build, sign, notarize and upload installers to a draft GitHub release
```

- **macOS signing** uses a "Developer ID Application" certificate from the keychain, or `CSC_LINK` (a .p12, path or base64) with `CSC_KEY_PASSWORD`. Without one the build is unsigned (`pnpm package` still works); `CSC_IDENTITY_AUTO_DISCOVERY=false` forces that. Hardened runtime is on, with the entitlements in `build/entitlements.mac.plist`.
- **Notarization** runs when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) are set, and is skipped otherwise.
- **Windows signing** happens when `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` are set.
- **Publishing** needs `GH_TOKEN` with access to `NietThijmen/looking-glass`. Releases are created as drafts; publish the draft on GitHub to ship it.
- **Auto-update**: packaged builds check GitHub releases at startup and every six hours, download in the background and install on quit. "Check for Updates…" is in the app menu (Help on Windows/Linux). macOS only installs updates for signed builds, so updating starts working from the first signed release.

### How the skeleton is wired

- **IPC contract**: every channel is declared once in `src/shared/ipc.ts`. Main registers handlers with the typed `handle()` in `src/main/ipc/typed.ts`, which rejects calls from any frame that isn't the app's own renderer. The preload builds a domain-shaped `window.lookingglass` API from those channels. There is no generic `invoke` passthrough.
- **Adding a channel**: add it to `InvokeContract` or `EventContract`, add the method to `LookingglassApi`, implement it in `src/preload/index.ts`, and register a handler in `src/main/ipc/`. The typechecker flags any step you miss.
- **Security defaults**: sandboxed renderer, context isolation, no Node in the renderer, a strict CSP, all permission requests denied, `window.open` and `<webview>` blocked, and navigation locked to the app origin (`src/main/security/`). Packaged builds serve the renderer from `app://lookingglass/` through a protocol handler confined to the build folder, not from `file://`.
- **Dependencies**: anything that ends up bundled into the renderer or preload (React, Zustand, …) goes in `devDependencies`, which keeps it out of the packaged `app.asar`. Only native or main-process runtime modules belong in `dependencies`.
- **`pnpm-workspace.yaml`**: `allowBuilds` lists which packages may run install scripts.
- **Native modules**: `node-pty` and `@parcel/watcher` use N-API prebuilds, so no Electron rebuild is needed. `scripts/fix-node-pty.mjs` (run on `postinstall`) restores the execute bit on node-pty's `spawn-helper`, which pnpm drops; without it every terminal fails with `posix_spawnp failed`. Packaged builds unpack ripgrep and node-pty from the asar (`electron-builder.yml`).

### How the editor shell is wired

- **Workspace access** goes through `WorkspaceService` (`src/main/workspace/`), which confines every path to the workspace root, including through symlinks. The ACP `fs/*` handlers in Phase 2 will reuse it.
- **Buffers** live in the renderer's editor store: `saved` (disk), `draft` (editor) and `base` (what the editor was mounted with). Dirty means `draft !== saved`. A file changed on disk reloads silently when clean and shows a conflict banner when dirty.
- **Editor**: `@pierre/diffs` `File` in edit mode, keyed by path and disk version so undo history survives tab switches. Paste goes through the main-process clipboard because the sandboxed renderer has no clipboard-read permission.
- **Terminal**: `ghostty-web` in the renderer, `node-pty` in main. Output is batched every 8 ms; a small bus buffers output that arrives before a view attaches.
- **Search** runs `rg --json` with one search at a time (a new query cancels the old one) and stops at 2000 matches.
- **Git** shells out to `git status --porcelain=v2 -z`; paths are made workspace-relative, so a workspace inside a larger repo works.

### How the agent side is wired

- **One process per agent**, shared by all its chats (`src/main/acp/`). `AcpClient` wraps the ACP SDK over stdio; `AgentManager` starts agents lazily, restarts them on next use after a crash, and stops them all when the workspace changes (sessions are bound to a folder).
- **Agent file reads** (`fs/read_text_file`) return unsaved editor contents first (the renderer publishes a snapshot of open and dirty files), then disk, always through `WorkspaceService`. Absolute agent paths are mapped into the workspace, including `/tmp` vs `/private/tmp` style spellings; anything outside is refused.
- **Agent file writes** go to disk and into review (`src/main/review/`): `Checkpoints` is the shadow git repo, `ReviewService` keeps baselines, and the renderer's `review/hunks.ts` does per-hunk keep/undo by rebuilding text from diff segments.
- **Agent terminals** (`src/main/terminal/AgentTerminals.ts`): `terminal/create` runs the command in a real pty that appears as a tab in the terminal panel; the agent gets plain text (ANSI stripped, tail kept within `outputByteLimit`).
- **Permissions**: `PermissionService` answers read/search/think requests with the agent's "allow once" option and asks the user for everything else. Stop answers open requests with `cancelled`, as ACP requires.
- **Login**: if `session/new` fails with `auth_required`, the chat shows the agent's auth methods. Terminal methods run in a Lookingglass terminal tab; the user retries when done.
- **Editor MCP server**: a Streamable HTTP MCP server on 127.0.0.1 with a random bearer token, passed to every session whose agent supports HTTP MCP. Tools: `get_workspace_info`, `get_open_editors`, `get_git_status`, `open_file`, `get_diagnostics`, and `browser_*` (see `src/main/browser/browserTools.ts`).
- **Browser**: `BrowserService` (`src/main/browser/`) owns `WebContentsView` tabs in a `persist:lookingglass-browser` partition; the renderer reserves layout and syncs bounds over IPC. Picking uses CDP inspect mode (`elementContext.ts`); dev-server URLs are detected in `terminalBus.ts`. Smoke covers console capture, picking, MCP `browser_snapshot` / `browser_click`, and opening a detected local URL.
- **Diagnostics**: `DiagnosticsService` (`src/main/lsp/`) runs `typescript-language-server` with Electron's Node and the workspace's own `typescript` (no TypeScript is bundled, so a folder without it gets no diagnostics). It keeps the server's documents in step with the editor's open TS/JS files, unsaved edits included, and with disk changes. Results become editor markers, `@problems`, and the `get_diagnostics` MCP tool, which can also open a file just to check it.
- **Settings**: app preferences live in `settings.json` in the app's userData folder (`src/main/state/settings.ts`). The theme sets Electron's `nativeTheme`, and the renderer, `@pierre/diffs`, the file tree and the terminal all follow `prefers-color-scheme`. Keybindings are Electron accelerators that override the defaults in `src/shared/settings.ts`; the app menu is rebuilt when they change. Custom agents are read from and written to `~/.lookingglass/agents.json` (`LOOKINGGLASS_HOME` moves it). Smoke runs use a throwaway userData folder and agents file.
- **Fake agent** (`src/main/acp/fakeAgent.ts`): a scriptable ACP agent used by unit tests and smoke runs, and offered in dev builds. Prompts `read <path>`, `edit`, `slow` and anything else exercise reads, permissions, cancel and streaming.
- **Real-agent smoke**: `LOOKINGGLASS_SMOKE_CLAUDE=1 pnpm smoke` (or `smoke:packaged`) also runs one real Claude Code turn. It needs a logged-in `claude` and uses a few tokens.

To try a real agent you need its CLI logged in first, for example `claude` for Claude Code.

## References

- Agent Client Protocol: https://agentclientprotocol.com
- ACP spec and SDKs: https://github.com/agentclientprotocol
- ACP adapters (Claude Code, Codex and others): https://github.com/agentclientprotocol
- Model Context Protocol: https://modelcontextprotocol.io
