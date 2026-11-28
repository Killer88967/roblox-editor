# @rbxe/luau

Luau ([luau-lang/luau](https://github.com/luau-lang/luau)) compiled to WebAssembly, with the
play-mode runtime: a small Roblox engine written in Luau (`runtime/*.luau`) that runs your
Scripts and LocalScripts against a copy of the place.

- `src/bridge.cpp` — the VM's interface to JavaScript (`rt_init`, `rt_send`, host imports).
- `runtime/` — instances, signals, the task scheduler, datatypes, services, tweens, require.
  Files run in name order; the last returns the message dispatcher.
- `wasm/luau.wasm` — the build output, committed (CI rebuilds it on PRs).
- `index.js` — loads the module and wraps it in `LuauVM`.

The JS side of the protocol (answering host calls against the place) lives in
`apps/web/src/lib/play/host.ts`.

## Building

Needs clang/lld 18 and Ubuntu's wasm32 packages:

```sh
sudo apt-get install clang-18 lld-18 wasi-libc libc++-18-dev-wasm32 libc++abi-18-dev-wasm32 libclang-rt-18-dev-wasm32
pnpm --filter @rbxe/luau build:wasm
pnpm --filter @rbxe/luau test
```

The build fetches the pinned Luau release and LLVM's libc++abi/libunwind sources (Ubuntu's
libc++abi has no exception support, which Luau's parser and compiler need).
