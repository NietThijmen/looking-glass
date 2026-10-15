# Installation

## Download an installer

Grab the latest build from [GitHub Releases](https://github.com/NietThijmen/looking-glass/releases).

| OS      | File           | Notes                                            |
| ------- | -------------- | ------------------------------------------------ |
| macOS   | `.dmg`         | Drag Lookingglass to Applications.               |
| Windows | NSIS installer | Run the `.exe` and follow the prompts.           |
| Linux   | `.AppImage`    | `chmod +x Lookingglass-*.AppImage`, then run it. |

Releases may be unsigned if the maintainer had no signing certificates available. On Windows, choose **More info → Run anyway** in SmartScreen. On macOS, see below.

### Windows

The install script downloads the latest release (x64 only) and runs its installer silently. It installs for the current user, so it needs no administrator rights. Run it in PowerShell:

```powershell
irm https://raw.githubusercontent.com/NietThijmen/looking-glass/main/installer/windows.ps1 | iex
```

[Read the script](../installer/windows.ps1) before piping it to `iex`. It only downloads from this project's GitHub Releases.

### Linux

The install script downloads the latest AppImage (x86_64 only), puts a `lookingglass` command in `~/.local/bin` and adds an application menu entry:

```bash
curl -fsSL https://raw.githubusercontent.com/NietThijmen/looking-glass/main/installer/linux.sh | bash
```

Set `INSTALL_DIR` or `BIN_DIR` to install elsewhere. As with the macOS script, [read it](../installer/linux.sh) before piping it to `bash`. AppImages need `libfuse2` (on Debian and Ubuntu: `sudo apt install libfuse2`).

### macOS

The quickest way is the install script. It downloads the latest release, copies it to `/Applications` and removes the quarantine flag:

```bash
curl -fsSL https://raw.githubusercontent.com/NietThijmen/looking-glass/main/installer/mac.sh | bash
```

Set `INSTALL_DIR` to install somewhere else. The script is short, so [read it](../installer/mac.sh) before piping it to `bash`. It only downloads from this project's GitHub Releases. To install by hand instead, read on.

Lookingglass is not signed or notarized with an Apple Developer ID, so macOS Gatekeeper blocks it the first time with a message like _"Lookingglass is damaged"_ or _"can't be opened because Apple cannot check it for malicious software"_. The app is fine. To open it anyway:

1. Drag Lookingglass to **Applications** and try to open it once (it will be blocked).
2. Open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway** next to Lookingglass. Confirm with your password.

On macOS 14 and earlier you can instead right-click the app and choose **Open**.

If macOS still says the app is damaged, remove the quarantine flag in a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Lookingglass.app
```

You only need to do this once per downloaded version. Only do it for builds you downloaded from this project's [GitHub Releases](https://github.com/NietThijmen/looking-glass/releases).

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
