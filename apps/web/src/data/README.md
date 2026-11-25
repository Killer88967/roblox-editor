# roblox-api.json

Roblox engine API data (classes, members, enums, datatypes, libraries, globals) used by
the script editor's autocomplete, hover and parameter hints.

- **Source:** [Roblox Creator Documentation](https://github.com/Roblox/creator-docs),
  `content/en-us/reference/engine`.
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This file is a
  trimmed and modified subset (names, types, parameters and shortened summaries).
- **Regenerate:**

  ```bash
  git clone --depth 1 --filter=blob:none --sparse https://github.com/Roblox/creator-docs /tmp/creator-docs
  git -C /tmp/creator-docs sparse-checkout set content/en-us/reference/engine
  node scripts/gen-roblox-api.mjs /tmp/creator-docs
  ```
