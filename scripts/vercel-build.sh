
#!/usr/bin/env bash
set -euo pipefail

# Install native build dependencies.
if ! command -v clang >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      apt-get update
      apt-get install -y --no-install-recommends clang llvm
    elif command -v sudo >/dev/null 2>&1; then
      sudo apt-get update
      sudo apt-get install -y --no-install-recommends clang llvm
    else
      echo "Error: Cannot install clang and llvm (no root or sudo access)."
      exit 1
    fi
  else
    echo "Error: apt-get is unavailable; cannot install clang and llvm."
    exit 1
  fi
fi

# Configure Rust locations and PATH.
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

# Install rustup if necessary.
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal

  export PATH="$CARGO_HOME/bin:$PATH"
fi

# Ensure the stable Rust toolchain is installed.
rustup toolchain install stable --profile minimal
rustup default stable

# Install the WebAssembly target.
rustup target add wasm32-unknown-unknown

# Install wasm-pack if necessary.
if ! command -v wasm-pack >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf \
    https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

  export PATH="$CARGO_HOME/bin:$PATH"
fi

# Build the monorepo.
pnpm build
