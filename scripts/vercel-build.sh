
#!/usr/bin/env bash
set -euo pipefail

# Install Rust if it isn't already available.
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal
fi

# Make Rust available in this shell.
source "$HOME/.cargo/env"

# Install the WebAssembly compilation target.
rustup target add wasm32-unknown-unknown

# Install wasm-pack if necessary.
if ! command -v wasm-pack >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf \
    https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
fi

# Build the monorepo.
pnpm build
