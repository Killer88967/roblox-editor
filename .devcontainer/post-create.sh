#!/usr/bin/env bash
set -euo pipefail

# C toolchain for wasm (zstd-sys)
sudo apt-get update && sudo apt-get install -y --no-install-recommends clang llvm

# Rust: WASM target + tooling
rustup target add wasm32-unknown-unknown
rustup component add clippy rustfmt

# cargo-binstall for fast prebuilt binaries
curl -L --proto '=https' --tlsv1.2 -sSf \
  https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash
cargo binstall -y wasm-pack

# Install JS deps once the monorepo exists
if [ -f pnpm-lock.yaml ]; then
  pnpm install
fi

# Oh My Posh
mkdir -p "$HOME/.local/bin"
curl -s https://ohmyposh.dev/install.sh | bash -s -- -d "$HOME/.local/bin"
mkdir -p "$HOME/.config/oh-my-posh"
ln -sf "$PWD/.devcontainer/theme.omp.json" "$HOME/.config/oh-my-posh/theme.omp.json"

# Oh My Zsh plugins
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
[ -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ] || \
  git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
[ -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ] || \
  git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"

# .zshrc: Oh My Posh takes over the prompt, Oh My Zsh handles plugins
sed -i 's/^ZSH_THEME=.*/ZSH_THEME=""/' "$HOME/.zshrc"
sed -i 's/^plugins=(.*)/plugins=(git rust zsh-autosuggestions zsh-syntax-highlighting)/' "$HOME/.zshrc"
grep -q 'oh-my-posh init' "$HOME/.zshrc" || cat >> "$HOME/.zshrc" <<'EOF'

export PATH="$HOME/.local/bin:$PATH"
eval "$(oh-my-posh init zsh --config ~/.config/oh-my-posh/theme.omp.json)"
EOF
