#!/bin/bash
set -euo pipefail

# Run from Terminal or double-click this file in Finder.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)/experiments/effectcraft"
binary="$repo_dir/target/release/effectcraft"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: launch-effectcraft.command [--rebuild] [EffectCraft arguments...]

Launch the local EffectCraft desktop app. Build it if no executable exists.
  --rebuild       Build the checked-out source before launching (Rust 1.95+).
  --empty         Open an empty project.
  --demo          Open the demo project.
  --version       Print the executable's version.
  /path/to/project.ecproj    Open a project (use an absolute path).

The first build downloads dependencies and can take several minutes.
This script does not pull upstream changes or enable a control server.
HELP
  exit 0
fi

rebuild=false
if [[ "${1:-}" == "--rebuild" ]]; then
  rebuild=true
  shift
fi

if [[ ! -f "$repo_dir/Cargo.toml" ]]; then
  printf 'EffectCraft checkout missing: %s\nClone https://github.com/storytold/effectcraft there first.\n' "$repo_dir" >&2
  exit 1
fi

if [[ "$rebuild" == true || ! -x "$binary" ]]; then
  # Finder does not inherit a terminal's Homebrew/Rust PATH.
  export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  if ! command -v cargo >/dev/null 2>&1; then
    printf 'Rust 1.95+ is required to build EffectCraft. Install it from https://rustup.rs/ and retry.\n' >&2
    exit 1
  fi
  (cd -- "$repo_dir" && CARGO_TARGET_DIR="$repo_dir/target" cargo build --locked --release -p effectcraft)
fi

# Keep the caller's working directory so relative project arguments still work.
exec "$binary" "$@"
