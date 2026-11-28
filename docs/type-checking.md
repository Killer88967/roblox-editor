# Type checking

The script editor runs **Luau's own type checker** (the same one Studio and luau-lsp use) as
you type. Its problems show as red squiggles next to Script Analysis' warnings, and count in
the status strip.

- **Roblox's API is known**: classes, properties, methods, events (`PlayerAdded` gives a
  `Player`), enums (`Enum.Material`), datatypes with their math (`Vector3 * 2`,
  `CFrame * CFrame`), `task`, and the globals.
- **`Instance.new("Part")` is a `Part`** and `game:GetService("Players")` is `Players`;
  `FindFirstChildWhichIsA("Model")` is a `Model?`. A name that isn't a class or service is
  an error.
- **Your place is known**: `script.Parent.Coins` is the TextLabel named Coins,
  `workspace.Door` is that Part, and `WaitForChild("X")`/`FindFirstChild("X")` give the
  child's type.
- **`require()` works between ModuleScripts** (`script.Parent.Config`,
  `game.ReplicatedStorage.Config`, `game:GetService("ReplicatedStorage"):WaitForChild("Config")`,
  or a local holding any of these). The module's returned table is typed, and editing the
  module updates the scripts that require it.
- **Modes like Studio's**: scripts are nonstrict (only certain errors) unless they start with
  `--!strict`; `--!nocheck` turns checking off.

Syntax errors and unknown globals are left to Script Analysis, which has quick fixes for them.

## How it works

- `packages/luau/wasm/analysis.wasm`: Luau.Analysis (luau-lang/luau 0.748) built for
  WebAssembly (`src/analysis.cpp` is the interface). `ClassFromString` and `PlaceLookup`
  narrow lookups from string arguments, like luau-lsp's "magic functions".
- `packages/luau/types/roblox.d.luau`: Roblox's API as Luau definitions, generated from
  `apps/web/src/data/roblox-api.json` by `node scripts/gen-luau-types.mjs` (CI checks it's up
  to date).
- `apps/web/src/lib/luau-typecheck.worker.ts` runs the checker in a Web Worker (loading the API
  takes about a second); `luau-typecheck.ts` sends it the place's instance tree and
  ModuleScript sources as they change; `luau-editor.ts` turns results into markers.
- `packages/luau/test-analysis.mjs` covers strict errors, Roblox types, place types and
  `require` (run in CI).
