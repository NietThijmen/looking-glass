#!/usr/bin/env bash
# Installs the latest Lookingglass release on Linux (x86_64 AppImage), adds a
# `lookingglass` command and an application menu entry.
#
#   curl -fsSL https://raw.githubusercontent.com/NietThijmen/looking-glass/main/installer/linux.sh | bash
#
# Environment:
#   INSTALL_DIR  where to put the AppImage (default: ~/.local/share/lookingglass)
#   BIN_DIR      where to put the `lookingglass` symlink (default: ~/.local/bin)
set -euo pipefail

REPO="NietThijmen/looking-glass"

die() {
  echo "error: $*" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || die "this installer only supports Linux"
[ "$(uname -m)" = "x86_64" ] || die "releases only include x86_64 builds (this machine is $(uname -m))"

install_dir="${INSTALL_DIR:-$HOME/.local/share/lookingglass}"
bin_dir="${BIN_DIR:-$HOME/.local/bin}"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$install_dir" "$bin_dir" "$data_dir/applications" "$data_dir/icons"

echo "Looking up the latest release..."
release="$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest")" ||
  die "couldn't fetch the latest release from GitHub"

url="$(printf '%s' "$release" | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | sed 's/.*"\(https[^"]*\)"/\1/' | head -n 1 || true)"
[ -n "$url" ] || die "the latest release has no AppImage download"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $(basename "$url")..."
curl -fL --progress-bar -o "$tmp/Lookingglass.AppImage" "$url" || die "download failed"
chmod +x "$tmp/Lookingglass.AppImage"

# mv over a running AppImage is safe: the old file stays open until the app exits.
mv -f "$tmp/Lookingglass.AppImage" "$install_dir/Lookingglass.AppImage"
ln -sf "$install_dir/Lookingglass.AppImage" "$bin_dir/lookingglass"

icon="$data_dir/icons/lookingglass.png"
if curl -fsSL -o "$icon" "https://raw.githubusercontent.com/$REPO/main/build/icon.png"; then
  icon_line="Icon=$icon"
else
  rm -f "$icon"
  icon_line="Icon=lookingglass"
fi

cat >"$data_dir/applications/lookingglass.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Lookingglass
Comment=An AI-first code editor for ACP agents
Exec=$install_dir/Lookingglass.AppImage %U
$icon_line
Categories=Development;IDE;
Terminal=false
DESKTOP
command -v update-desktop-database >/dev/null && update-desktop-database "$data_dir/applications" 2>/dev/null || true

echo "Installed $install_dir/Lookingglass.AppImage"
case ":$PATH:" in
  *":$bin_dir:"*) echo "Run it with: lookingglass" ;;
  *) echo "Add $bin_dir to your PATH to run it with: lookingglass" ;;
esac
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  echo "note: AppImages need libfuse2 (Debian/Ubuntu: sudo apt install libfuse2)."
  echo "      Without it, run: $install_dir/Lookingglass.AppImage --appimage-extract-and-run"
fi
