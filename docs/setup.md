# Setup

Everything you may want to configure, in the order you'll probably need it.

## Log in to Claude Code

Claude Code is bundled. Any one of these works:

- You already use the `claude` CLI: you're logged in, nothing to do.
- Run `claude` once in a terminal and log in.
- Set `ANTHROPIC_API_KEY` in the environment Lookingglass is started from.

If an agent needs a login, the chat shows that agent's login options.

## Use other agents

Lookingglass has no AI of its own. It talks to any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com).

1. Install the agent or its ACP adapter yourself (for example `codex-acp` for Codex, or Gemini CLI's ACP mode).
2. Add it in **Settings → Agents**, or edit `~/.lookingglass/agents.json`:

```jsonc
// ~/.lookingglass/agents.json
{
  "codex": { "label": "Codex", "command": "codex-acp", "args": [] },
  "my-agent": { "label": "My Agent", "command": "/usr/local/bin/my-agent", "args": ["--acp"] },
}
```

Check each agent's own docs for its current command and flags. The built-in Claude Code id can't be overridden. Agents use their own login and subscription, and you can run several at once, each in its own chat.

## Per-project settings

Add `.lookingglass/settings.json` to a project to set a default preview URL and extra MCP servers for every chat in that folder:

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

## Better source mapping

The element picker finds the source file of an element through React, Vue and Svelte dev metadata, stylesheet source maps and a search fallback. For exact results, have your build tooling add a `data-lg-source` attribute in dev builds:

```html
<button data-lg-source="src/Hero.tsx:42:7">Get started</button>
```

## Keyboard shortcuts

Change any of them in **Settings** (`⌘,`). On Windows and Linux, `⌘` is `Ctrl`.

| Action                    | Default       |
| ------------------------- | ------------- |
| Open folder               | `⌘O`          |
| Save / Close tab          | `⌘S` / `⌘W`   |
| Settings                  | `⌘,`          |
| Pick element in browser   | `⌘⇧C`         |
| New browser tab           | `⌘⇧B`         |
| Edit selection with agent | `⌘K`          |
| Toggle terminal           | `` ⌃` ``      |
| Toggle sidebar            | `⌘B`          |
| Explorer / Search         | `⌘⇧E` / `⌘⇧F` |
| Source control / Commits  | `⌃⇧G` / `⌃⇧H` |
| Agents                    | `⌘⇧A`         |

## Theme

Choose dark, light or system in **Settings**.
