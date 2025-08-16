#!/usr/bin/env bash
set -euo pipefail

# ---------- Config (override via env) ----------
REPO="${REPO:-wraith4081/wraith-cli}"           # e.g. acme/wraith-cli
# BINARY_NAME is the installed command name (ai on Unix)
BINARY_NAME="${BINARY_NAME:-ai}"
VERSION="${VERSION:-latest}"         # "latest" or "vX.Y.Z"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
SKIP_SHA="${SKIP_SHA:-0}"            # set to 1 to skip checksum verification

# ---------- OS/Arch detection ----------
uname_s=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$uname_s" in
  linux)   OS_TAG="linux"  ;;
  darwin)  OS_TAG="macos"  ;;
  *) echo "Unsupported OS: $uname_s" >&2; exit 1 ;;
esac

uname_m=$(uname -m | tr '[:upper:]' '[:lower:]')
case "$uname_m" in
  x86_64|amd64) ARCH_TAG="x64"   ;;
  arm64|aarch64) ARCH_TAG="arm64" ;;
  *) echo "Unsupported arch: $uname_m" >&2; exit 1 ;;
esac

# Your current matrix (based on provided releases):
# - linux: x64 only (wraith-cli-linux-x64)
# - macOS: arm64 only (wraith-cli-macos-arm64)
if [[ "$OS_TAG" == "linux" && "$ARCH_TAG" != "x64" ]]; then
  echo "No prebuilt binary for Linux/$ARCH_TAG yet." >&2; exit 1
fi
if [[ "$OS_TAG" == "macos" && "$ARCH_TAG" != "arm64" ]]; then
  echo "No prebuilt binary for macOS/$ARCH_TAG yet." >&2; exit 1
fi

# Release asset base name is fixed
ASSET_BASE="wraith-cli"
ASSET="${ASSET_BASE}-${OS_TAG}-${ARCH_TAG}"
EXT="" # raw binary for unix
ASSET_FILE="${ASSET}${EXT}"
SHA_FILE="${ASSET_FILE}.sha256"

if [[ "$VERSION" == "latest" ]]; then
  BASE="https://github.com/${REPO}/releases/latest/download"
else
  BASE="https://github.com/${REPO}/releases/download/${VERSION}"
fi

URL="${BASE}/${ASSET_FILE}"
SHA_URL="${BASE}/${SHA_FILE}"

# ---------- Helpers ----------
have() { command -v "$1" >/dev/null 2>&1; }
fetch() {
  local url="$1" out="$2"
  if have curl; then curl -fL --retry 3 --connect-timeout 10 -o "$out" "$url"
  elif have wget; then wget -q -O "$out" "$url"
  else echo "Need curl or wget" >&2; return 1; fi
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else echo ""; return 1; fi
}

# ---------- Install dir ----------
mkdir -p "$INSTALL_DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bin="$tmp/$ASSET_FILE"
echo "Downloading $URL"
fetch "$URL" "$bin"
chmod +x "$bin"

# ---------- Verify sha256 if available ----------
if [[ "$SKIP_SHA" != "1" ]]; then
  echo "Fetching checksum $SHA_URL (if present)"
  sha_txt="$tmp/$SHA_FILE"
  if fetch "$SHA_URL" "$sha_txt"; then
    want_hash="$(grep -Eo '[a-f0-9]{64}' "$sha_txt" | head -n1 || true)"
    if [[ -z "$want_hash" ]]; then
      echo "Warning: could not parse checksum file; skipping verification." >&2
    else
      got_hash="$(sha256_of "$bin" || true)"
      if [[ -z "$got_hash" ]]; then
        echo "Warning: no sha256 tool available; skipping verification." >&2
      elif [[ "$got_hash" != "$want_hash" ]]; then
        echo "Checksum mismatch!" >&2
        echo "  expected: $want_hash" >&2
        echo "  got     : $got_hash" >&2
        exit 1
      else
        echo "Checksum OK ($got_hash)"
      fi
    fi
  else
    echo "Checksum file not found; continuing without verification." >&2
  fi
else
  echo "Skipping checksum verification (SKIP_SHA=1)"
fi

# ---------- Move into place ----------
target="$INSTALL_DIR/$BINARY_NAME"
mv -f "$bin" "$target"
chmod +x "$target"

# macOS: clear quarantine if present
if [[ "$OS_TAG" == "macos" ]] && have xattr; then
  xattr -d com.apple.quarantine "$target" 2>/dev/null || true
fi

# ---------- Add to PATH if missing ----------
case ":$PATH:" in *":$INSTALL_DIR:"*) ;; *)
  line="export PATH=\"$INSTALL_DIR:\$PATH\""
  shell_name="$(basename "${SHELL:-}")"
  add_line() { local f="$1"; local l="$2"; touch "$f"; grep -Fqs "$l" "$f" || printf '\n%s\n' "$l" >> "$f"; }
  case "$shell_name" in
    zsh)  add_line "$HOME/.zshrc" "$line"  ;;
    bash|"") add_line "$HOME/.bashrc" "$line"; add_line "$HOME/.profile" "$line" ;;
    fish) mkdir -p "$HOME/.config/fish"; f="$HOME/.config/fish/config.fish"; touch "$f"; grep -Fqs "$INSTALL_DIR" "$f" || printf '\nset -Ux PATH "%s" $PATH\n' "$INSTALL_DIR" >> "$f" ;;
    *)    add_line "$HOME/.profile" "$line" ;;
  esac
  echo "Added $INSTALL_DIR to PATH. Open a new shell or: source ~/.profile ~/.bashrc ~/.zshrc"
esac

echo "✅ Installed: $target"
echo "Try:  $BINARY_NAME --version"
