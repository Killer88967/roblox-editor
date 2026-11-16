
#!/usr/bin/env bash
set -euo pipefail

# Configure Rust locations and PATH.
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

# Install rustup if it isn't available.
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal

  export PATH="$CARGO_HOME/bin:$PATH"
fi

# Ensure the stable Rust toolchain is installed.
if ! rustup toolchain list | grep -q '^stable'; then
  rustup toolchain install stable --profile minimal
fi

rustup default stable

# Install the WebAssembly compilation target.
rustup target add wasm32-unknown-unknown

# Install wasm-pack if necessary.
if ! command -v wasm-pack >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf \
    https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

  export PATH="$CARGO_HOME/bin:$PATH"
fi

# Build the monorepo.
pnpm build
