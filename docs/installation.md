# Installation

## Download an installer

Grab the latest build from [GitHub Releases](https://github.com/NietThijmen/looking-glass/releases).

| OS      | File           | Notes                                            |
| ------- | -------------- | ------------------------------------------------ |
| macOS   | `.dmg`         | Drag Lookingglass to Applications.               |
| Windows | NSIS installer | Run the `.exe` and follow the prompts.           |
| Linux   | `.AppImage`    | `chmod +x Lookingglass-*.AppImage`, then run it. |

Releases may be unsigned if the maintainer had no signing certificates available. On macOS, if Gatekeeper blocks the app, right-click it and choose **Open**, or allow it in **System Settings → Privacy & Security**. On Windows, choose **More info → Run anyway** in SmartScreen.

You don't need Node installed. Claude Code ships inside the app and runs on Electron's own Node.

## Updates

Lookingglass checks GitHub releases for new versions and updates itself (`electron-updater`).

## First launch

1. Open the app and pick a folder with `File → Open Folder…` (`⌘O`, `Ctrl+O` on Windows and Linux).
2. Make sure your agent is logged in. See [Setup](setup.md#log-in-to-claude-code).

## Build from source

Requirements: **Node 24+** and **pnpm 11** (the `packageManager` field in `package.json` downloads the right pnpm for you if you use Corepack).

```bash
git clone https://github.com/NietThijmen/looking-glass.git
cd looking-glass
pnpm install
pnpm dev
```

`pnpm install` also runs a postinstall step that fixes up `node-pty` and downloads the Electron binary.

| Command            | What it does                                                 |
| ------------------ | ------------------------------------------------------------ |
| `pnpm dev`         | Run the app with hot reload                                  |
| `pnpm build`       | Production build into `out/`                                 |
| `pnpm package:dir` | Build an unpacked app (quick check of a packaged build)      |
| `pnpm package`     | Build installers for your platform into `release/<version>/` |
| `pnpm check`       | Typecheck, lint, prettier and unit tests                     |
| `pnpm smoke`       | Build and drive the real app against a throwaway git repo    |

Set `LOOKINGGLASS_WORKSPACE=/some/folder pnpm dev` to open a specific folder on launch. Dev builds also offer a scriptable **fake agent** so you can test the UI without spending tokens.

## Releasing (maintainers)

Pushing a tag like `v0.1.0` that matches the `version` in `package.json` runs the release workflow: it runs `pnpm check`, builds installers for macOS, Windows and Linux and attaches them to a draft GitHub release. Signing and notarization run only when the matching secrets are set (see `.github/workflows/release.yml`).

## Troubleshooting

- **`pnpm install` fails on `node-pty`.** You need a C/C++ toolchain: Xcode Command Line Tools on macOS, build-essential and Python on Linux, Visual Studio Build Tools on Windows.
- **The agent says it needs to log in.** See [Setup](setup.md#log-in-to-claude-code).
- **An agent from `agents.json` doesn't start.** Run its `command` in a terminal first. The command must be on your `PATH`, or use an absolute path.
