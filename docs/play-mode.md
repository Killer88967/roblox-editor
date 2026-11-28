# Play mode

**▶ Play** runs the place's Scripts and LocalScripts on a copy of it, like Studio's Play
Solo. The Explorer, Properties, 3D view and GUIs show the running game; **■ Stop** throws the
copy away and brings the place back exactly as it was. Saving, downloading and autosave always
use the place, never the play copy.

- **Output** shows `print`, `warn` and errors (with the script and line), and has a command
  bar that runs Luau as server code while playing.
- **GUIs**: the player's PlayerGui (a copy of StarterGui) is drawn over the 3D view. Buttons
  fire `MouseButton1Down/Up/Click`, `Activated`, `MouseEnter/Leave`; TextBoxes can be typed
  in (`Focused`, `FocusLost`, `Text` changes). `AbsoluteSize`/`AbsolutePosition` are real.
- **Input**: keys go to `UserInputService` and `ContextActionService` (not editor shortcuts)
  while playing; taps and clicks too. Tapping a part with a **ClickDetector** fires
  `MouseClick`.
- There's no physics: parts only move when scripts set their `CFrame`, `Position`, etc.

## What runs

One player (`Players.Player1`) joins after server scripts start. Server and client code share
one Luau VM, each with its own context (`RunService:IsServer()` / `IsClient()`), and separate
`require` caches.

| Script                    | Runs in                                                        |
| ------------------------- | -------------------------------------------------------------- |
| Script (RunContext Legacy) | Workspace, ServerScriptService                                |
| Script (Server / Client)  | anywhere except StarterGui, StarterPack, StarterPlayer, ServerStorage |
| LocalScript               | PlayerGui, Backpack, PlayerScripts, ReplicatedFirst            |
| ModuleScript              | when required                                                  |

Scripts also start when they're parented somewhere they run (e.g. a cloned tool or GUI).
A script that runs for 5 seconds without yielding is stopped with Roblox's timeout error.

## The API

- **Globals**: `game`, `workspace`, `script`, `task.*`, `wait`/`delay`/`spawn`, `tick`,
  `time`, `typeof`, `require`, `print`/`warn`, `shared`, `_G`, `Instance.new`.
- **Datatypes**: Vector3, Vector2, CFrame (full math), Color3, UDim, UDim2, BrickColor,
  NumberRange, NumberSequence, ColorSequence, Rect, Font, TweenInfo, Enum, Random, DateTime,
  Ray.
- **Instances**: properties (type-checked like Roblox), children by name, `Changed`,
  `GetPropertyChangedSignal`, `ChildAdded/Removed`, `DescendantAdded`, `Destroying`,
  `FindFirstChild*`, `WaitForChild`, `GetChildren/Descendants`, `IsA`, `Clone`, `Destroy`,
  attributes and tags, `PivotTo`/`GetPivot`, `Model:GetBoundingBox`, ...
- **Services**: TweenService (all easing styles, repeat/reverse), RunService
  (Heartbeat/RenderStepped/Stepped, BindToRenderStep), Players, UserInputService,
  ContextActionService, RemoteEvent/RemoteFunction (delivered on the next resumption, like a
  real network hop), BindableEvent/Function, CollectionService, DataStoreService (in memory
  for the session), HttpService (JSON, GUIDs), Debris, TextService, MarketplaceService and
  others as harmless stand-ins.

## Not yet

Physics and characters (no Humanoid movement, `Touched`, raycasts), sounds, BillboardGui and
SurfaceGui, HTTP requests, `require(assetId)`, and more than one player.

## How it works

- `packages/luau`: Luau (the VM and compiler from luau-lang/luau) compiled to WebAssembly,
  plus the runtime: a small Roblox engine written in Luau (`runtime/*.luau`) with the
  scheduler, signals, datatypes, services and tweens.
- `apps/web/src/lib/play/host.ts` answers the runtime's requests (read or set a property,
  create, clone, destroy, ...) against the play copy of the place, a fork of the WASM editor
  with the same instance ids.
- `apps/web/src/stores/play.ts` runs the frame loop, collects output, and swaps the play copy
  into the editor store so every panel shows it.
- `packages/luau/test.mjs` runs a place end to end in Node (CI runs it too).
