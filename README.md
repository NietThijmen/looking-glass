# Lookingglass

**A desktop GUI for coding agents, built for frontend developers.**

Lookingglass puts your app, your code and your agent in one window. Run your dev server, open it in the built-in browser, click the button that looks wrong, and ask the agent to fix it. The agent gets the element's markup, styles, a screenshot and the source file that rendered it. It edits the code, HMR reloads, and it takes its own screenshot to check the result. You review the change hunk by hunk before you keep it.

Lookingglass has no AI of its own. It speaks the [Agent Client Protocol (ACP)](https://agentclientprotocol.com), so it works with the agent you already use and pay for: Claude Code out of the box, or Codex, Gemini CLI or any other ACP agent.

```
┌──────────┬───────────────────────────────────────┬─────────────────────┐
│ EXPLORER │ Hero.tsx │ 🌐 localhost:5173 ●        │ Chat · Claude Code  │
│          │ ◀ ▶ ⟳  http://localhost:5173/  [⌖][📱]│─────────────────────│
│          │ ┌───────────────────────────────────┐ │ ┌─────────────────┐ │
│          │ │  My App            Login  Signup  │ │ │⌖ button.cta     │ │
│          │ │                    ┏━━━━━━━━━━━┓  │ │ │  Hero.tsx:42  ✕ │ │
│          │ │  Welcome back      ┃Get started┃◀─┼─┼─│ 160×44 · 📷     │ │
│          │ │                    ┗━━━━━━━━━━━┛  │ │ └─────────────────┘ │
│          │ │    ┌ button.cta  160×44 ────────┐ │ │ why is this not     │
│          │ │    │ Ask about this element…   ⏎│ │ │ vertically centered │
│          │ │    └────────────────────────────┘ │ │ with the heading?   │
│          │ └───────────────────────────────────┘ │                     │
│          │ CONSOLE  ⚠ 1  ✖ 2                     │                     │
└──────────┴───────────────────────────────────────┴─────────────────────┘
```

---

## Why

Coding agents are good at code but blind to the UI. You end up describing pixels in words ("the button in the top right, the blue one, under the nav"), pasting screenshots by hand, and copying console errors out of DevTools.

Lookingglass closes that gap:

- **Point instead of describe.** Pick an element in the page and the agent sees exactly what you see: HTML, matched CSS rules with their stylesheet and line, computed styles, accessible name and role, and a screenshot.
- **From pixel to file.** The picker maps an element back to the component that rendered it (`src/components/Hero.tsx:42`) using React, Vue and Svelte dev metadata, stylesheet source maps, and search as a fallback.
- **The agent checks its own work.** Every agent gets browser tools over MCP. It can snapshot the page, click, type, resize to a phone viewport, read the console and take screenshots, so "fix it and verify" is one turn.
- **Your agent, your subscription.** No new account, no proxied API keys, no model lock-in.

## Features

### Browser and element picker

- Browser tabs open next to your code, with an address bar, DevTools, and **device presets** (phone, tablet, desktop, custom sizes).
- **Dev server detection**: when `Local: http://localhost:5173` shows up in a terminal, Lookingglass offers to open it.
- **Element picker** (`⌘⇧C`): DevTools-style hover overlay, Shift+click to pick several elements, walk to the parent or child, or drag to capture a region.
- **"Ask about this element…"** popover: `Enter` asks the active chat, `⌘Enter` starts a new chat, `Esc` adds the element to your message as a chip. The chip shows exactly what will be sent, and you can untick parts of it.
- **Console panel** with console output, uncaught exceptions and failed network requests. Send any entry to chat, or mention `@browser-console`.

### Agent chat

- Streaming replies, thinking, tool calls as collapsible cards, and plans as a live checklist.
- **@-mentions**: `@file`, `@folder`, `@selection`, `@terminal`, `@git-diff`, `@problems`, `@browser` (screenshot + URL) and `@browser-console`. Paste or drop images straight into the chat.
- Several chats at once, each with its own agent, for example Claude Code in one and Codex in another.
- Agent modes (such as plan mode), session history, and resuming earlier chats.
- Permission prompts for edits and commands; reads and searches are allowed automatically.

### Reviewing agent edits

- Agent edits land on disk right away, so your dev server, HMR and tests see them.
- Every changed file shows up in a **changes bar** and a **review tab** with **Keep / Undo per hunk**, or Keep all / Undo all.
- A **checkpoint** is taken before every message. Hover a message and click **Restore** to roll every file back to that point. This works in folders that aren't git repos and never touches your own `.git`.
- **`⌘K` inline edit**: select code, describe the change, and the result opens in review.

### A real editor around it

File tree, tabs, syntax highlighting (via [`@pierre/diffs`](https://diffs.com)), project search (ripgrep), TypeScript diagnostics, git status, diffs, a commits view, commit and push, and an integrated terminal ([`ghostty-web`](https://github.com/coder/ghostty-web)). Agent-run commands open as terminal tabs you can watch and kill.

---

## Getting started

### 1. Install

Download the latest build from [GitHub releases](https://github.com/NietThijmen/looking-glass/releases), or [build it from source](#development).

### 2. Log in to your agent

Claude Code is bundled. If you've used the `claude` CLI before, you're already logged in; otherwise run `claude` once and log in, or set `ANTHROPIC_API_KEY`. If an agent needs a login, the chat shows its login options.

### 3. Open your project

`File → Open Folder…` (`⌘O`), start your dev server in the terminal (`` Ctrl+` ``), and open the URL it prints. Then pick an element and ask.

### Using other agents

Install the agent or its ACP adapter yourself, then add it in **Settings → Agents**, or edit `~/.lookingglass/agents.json` directly:

```jsonc
// ~/.lookingglass/agents.json
{
  "codex": { "label": "Codex", "command": "codex-acp", "args": [] },
  "my-agent": { "label": "My Agent", "command": "/usr/local/bin/my-agent", "args": ["--acp"] },
}
```

Check each agent's own docs for the current command and flags.

### Per-project settings

Put a `.lookingglass/settings.json` in your project to set a default preview URL and add MCP servers that every chat in that folder gets:

```jsonc
// <project>/.lookingglass/settings.json
{
  "previewUrl": "http://localhost:5173",
  "mcpServers": {
    "figma": { "command": "npx", "args": ["my-figma-mcp"] },
    "docs": { "type": "http", "url": "https://example.com/mcp" },
  },
}
```

The first chat in a folder asks before passing those MCP servers to the agent, so opening a cloned repo can't make an agent run its commands.

### Better source mapping

If your build tooling can add `data-lg-source="src/Hero.tsx:42:7"` attributes to elements, the picker uses them as exact locations. Without them it falls back to framework metadata, source maps and search.

---

## Keyboard shortcuts

All shortcuts can be changed in **Settings** (`⌘,`).

| Action                    | Default       |
| ------------------------- | ------------- |
| Open folder               | `⌘O`          |
| Pick element in browser   | `⌘⇧C`         |
| New browser tab           | `⌘⇧B`         |
| Edit selection with agent | `⌘K`          |
| Toggle terminal           | `` ⌃` ``      |
| Explorer / Search         | `⌘⇧E` / `⌘⇧F` |
| Source control / Commits  | `⌃⇧G` / `⌃⇧H` |

On Windows and Linux, `⌘` is `Ctrl`.

---

## Privacy and safety

- Agents run as separate processes. Every file path they use is confined to the open folder.
- Picked elements, screenshots and console output go to the agent you're chatting with, and so to its model provider. Pages you're logged into can contain personal data; check the chip before sending.
- The browser has its own profile, separate from the app. Agents can browse `localhost` and your preview URL freely, but navigating elsewhere and running JavaScript in the page need your permission.
- Lookingglass stores no credentials. Agent logins stay in each agent's own config.
- An agent that runs commands with its own tools instead of through Lookingglass runs with your user's privileges, just like running its CLI directly.

---

## Development

Requires Node 24+ and pnpm 11.

```bash
pnpm install
pnpm dev             # run the app with hot reload
pnpm check           # typecheck + lint + prettier + unit tests
pnpm smoke           # build, then drive the real app against a throwaway git repo
pnpm package         # installers for the current platform
```

`LOOKINGGLASS_WORKSPACE=/some/folder pnpm dev` opens a specific folder. Dev builds also offer a scriptable **fake agent** for testing without spending tokens.

Electron + React + TypeScript, built with electron-vite. The architecture, the ACP integration, how the picker works, the security model, releasing, and the roadmap are documented in [docs/design.md](docs/design.md).

## Links

- [Agent Client Protocol](https://agentclientprotocol.com)
- [ACP adapters and SDKs](https://github.com/agentclientprotocol)
- [Model Context Protocol](https://modelcontextprotocol.io)
