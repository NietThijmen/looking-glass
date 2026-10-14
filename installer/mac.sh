#!/usr/bin/env bash
# Installs the latest Lookingglass release on macOS and removes the quarantine flag, so
# Gatekeeper doesn't block the unsigned app.
#
#   curl -fsSL https://raw.githubusercontent.com/NietThijmen/looking-glass/main/installer/mac.sh | bash
#
# Environment:
#   INSTALL_DIR  where to put Lookingglass.app (default: /Applications, or ~/Applications
#                when /Applications isn't writable)
set -euo pipefail

REPO="NietThijmen/looking-glass"
APP="Lookingglass.app"

die() {
  echo "error: $*" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || die "this installer only supports macOS"

case "$(uname -m)" in
  arm64) arch="arm64" ;;
  x86_64) arch="x64" ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

install_dir="${INSTALL_DIR:-}"
if [ -z "$install_dir" ]; then
  if [ -w /Applications ]; then
    install_dir="/Applications"
  else
    install_dir="$HOME/Applications"
  fi
fi
mkdir -p "$install_dir"

echo "Looking up the latest release..."
release="$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest")" ||
  die "couldn't fetch the latest release from GitHub"

# Builds are named Lookingglass-<version>-<arch>.dmg; Intel builds omit the arch suffix.
urls="$(printf '%s' "$release" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | sed 's/.*"\(https[^"]*\)"/\1/')"
url="$(printf '%s\n' "$urls" | grep -- "-$arch\.dmg$" | head -n 1 || true)"
if [ -z "$url" ] && [ "$arch" = "x64" ]; then
  url="$(printf '%s\n' "$urls" | grep -v -- '-arm64\.dmg$' | head -n 1 || true)"
fi
[ -n "$url" ] || die "the latest release has no macOS $arch download"

tmp="$(mktemp -d)"
mount_point="$tmp/mount"
mounted=0
cleanup() {
  if [ "$mounted" = 1 ]; then hdiutil detach "$mount_point" -quiet -force || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

dmg="$tmp/Lookingglass.dmg"
echo "Downloading $(basename "$url")..."
curl -fL --progress-bar -o "$dmg" "$url" || die "download failed"

echo "Installing to $install_dir..."
mkdir -p "$mount_point"
hdiutil attach "$dmg" -nobrowse -readonly -quiet -mountpoint "$mount_point" || die "couldn't mount the disk image"
mounted=1
[ -d "$mount_point/$APP" ] || die "$APP not found in the disk image"

if pgrep -xq "Lookingglass"; then
  echo "note: Lookingglass is running. Restart it to use the new version."
fi
rm -rf "$install_dir/$APP"
# ditto keeps the app's permissions, symlinks and extended attributes intact.
ditto "$mount_point/$APP" "$install_dir/$APP"

# Downloaded with curl, so it has no quarantine flag normally; clear it anyway in case the
# file picked one up.
xattr -dr com.apple.quarantine "$install_dir/$APP" 2>/dev/null || true

echo "Installed $install_dir/$APP"
echo "Open it from Launchpad or run: open \"$install_dir/$APP\""
