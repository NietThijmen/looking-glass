# Usage

A tour of a typical session. Assumes you've [installed](installation.md) the app and [set up](setup.md) an agent.

## 1. Open your project

`⌘O` opens a folder. Start your dev server in the terminal (`` ⌃` ``). When something like `Local: http://localhost:5173` appears, Lookingglass offers to open it in a browser tab. You can also open one yourself with `⌘⇧B`, or set `previewUrl` in [project settings](setup.md#per-project-settings).

Browser tabs sit next to your code tabs. They have an address bar, DevTools and **device presets** (phone, tablet, desktop or a custom size).

## 2. Point at something

Press `⌘⇧C` to start the element picker.

- **Hover** to highlight elements, DevTools-style.
- **Click** to pick one, **Shift+click** to pick several.
- Walk to the **parent or child** of the picked element.
- **Drag** to capture a region instead.

An **Ask about this element…** popover appears:

| Key      | Does                                           |
| -------- | ---------------------------------------------- |
| `Enter`  | Ask the active chat                            |
| `⌘Enter` | Start a new chat with the question             |
| `Esc`    | Add the element to your chat message as a chip |

The chip shows exactly what will be sent: HTML, matched CSS rules, computed styles, accessible name and role, a screenshot and the source location (like `Hero.tsx:42`). Untick anything you don't want to share.

## 3. Chat with the agent

- Replies stream in, with thinking, tool calls as collapsible cards and plans as a live checklist.
- Reads and searches are allowed automatically. Edits and commands ask for permission.
- Run several chats at once, each with its own agent. Switch agent modes (like plan mode) when the agent offers them, and resume earlier chats from history.
- Paste or drop images straight into the message box.

### @-mentions

| Mention            | Adds                                    |
| ------------------ | --------------------------------------- |
| `@file`, `@folder` | A file or folder from your project      |
| `@selection`       | The code selected in the editor         |
| `@terminal`        | Recent terminal output                  |
| `@git-diff`        | Your uncommitted changes                |
| `@problems`        | Current TypeScript diagnostics          |
| `@browser`         | Screenshot and URL of the open page     |
| `@browser-console` | Console output, errors, failed requests |

### The agent can use the browser too

Every agent gets browser tools over MCP. It can snapshot the page, click, type, resize to a phone viewport, read the console and take screenshots. So "fix the layout on mobile and check it" works in one turn.

Agents can browse `localhost` and your preview URL freely. Navigating elsewhere or running JavaScript in the page asks you first.

## 4. Review what changed

Agent edits are written to disk right away, so your dev server, HMR and tests see them. Meanwhile:

- A **changes bar** and a **review tab** list every changed file with **Keep** / **Undo** per hunk, or **Keep all** / **Undo all**.
- A **checkpoint** is taken before every message. Hover a message and click **Restore** to roll all files back to that moment. It works in folders that aren't git repos and never touches your own `.git`.

### Inline edit

Select code, press `⌘K`, describe the change. The result opens in review.

## 5. Console

The console panel under the browser shows console output, uncaught exceptions and failed network requests. Send any entry to the chat, or mention `@browser-console`.

## 6. The editor around it

You can work without an agent:

- File tree, tabs and syntax highlighting
- Project search (`⌘⇧F`, powered by ripgrep)
- TypeScript diagnostics
- Git: status, diffs, a commits view, commit and push (`⌃⇧G`, `⌃⇧H`)
- Integrated terminal. Commands the agent runs open as terminal tabs you can watch and kill.

## Tips

- Pick the element _and_ describe the intent: "make this match the spacing of the card above" beats "fix this".
- Pages you're logged into can contain personal data. Check the chip before sending.
- Use plan mode for big changes, then review hunk by hunk.
