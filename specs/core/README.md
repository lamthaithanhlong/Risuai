# Core specs

| File | Tool | What it shows |
| --- | --- | --- |
| `AssetSweep.tla` (+ `_FALSE` / `_TRUE` cfg) | TLC | The startup asset cleanup deleted a file another client was about to reference (5 states). Two strikes holds. Fix: `src/ts/storage/assetSweep.ts`. |
| `GenerateContext.dfy` | Dafny (Z3) | 21 verified. A: the lorebook scan window `slice(length - depth)` loses messages when the chat is shorter than the depth (4 at depth 5 give 1), `lastItems` is exact. B: the lore token budget cut keeps the always-on entries when they come first in priority and fit the budget (the card fix). C: the context truncation loop keeps the newest message, never over-trims, and fails only when the newest message alone does not fit. |

The Dafny file models the algorithms; it does not verify the TypeScript. Each part is tied to the code by a test:
`src/ts/process/scanWindow.test.ts` (A), `fate-simulator/lint_card.py` replays B on the card, and C was read against
`index.svelte.ts` lines 1157-1167 and the recheck at 1521-1540. Break the model on purpose (change `<=` to `<`, drop the `- 1` in the loop bound,
use the old window formula) and Dafny rejects it.

Run: `dafny verify GenerateContext.dfy`; `java -cp tla2tools.jar tlc2.TLC -metadir /tmp/x -config AssetSweep_FALSE.cfg AssetSweep.tla`.
