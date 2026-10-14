# Core specs

| File | Tool | What it shows |
| --- | --- | --- |
| `AssetSweep.tla` (+ `_FALSE` / `_TRUE` cfg) | TLC | The startup asset cleanup deleted a file another client was about to reference (5 states). Two strikes holds. Fix: `src/ts/storage/assetSweep.ts`. |
| `GenerateContext.dfy` | Dafny (Z3) | 21 verified. A: the lorebook scan window `slice(length - depth)` loses messages when the chat is shorter than the depth (4 at depth 5 give 1), `lastItems` is exact. B: the lore token budget cut keeps the always-on entries when they come first in priority and fit the budget (the card fix). C: the context truncation loop keeps the newest message, never over-trims, and fails only when the newest message alone does not fit. |
| `MemoryChain.tla` + `MemoryChain_all/none/tail.cfg` | TLC | HypaV3 default (`Clean=all`): deleting one message inside a summarized range drops the whole summary, and the survivors of that range land in neither the context nor a summary (9 states). `none` (preserveOrphanedMemory) and `tail` (the fix: drop orphaned summaries only from the end of the chain) hold over 451 states. Fix: `src/ts/process/memory/hypaOrphans.ts`. |
| `ChatSlot.tla` + `ChatSlot_TRUE/FALSE.cfg` | TLC | `sendChat` keeps `selectedChat` as an index across minutes of awaiting; New Chat does `chats.unshift`, so the reply lands in the wrong chat (3 steps). Following the chat by id holds (134 states). Fix: `src/ts/process/chatSlot.ts`, used for every index in `sendChat`. |
| `MemoryBudget.dfy` | Dafny | 9 verified. HypaV3's memory budget: with recent + similar ratios at most 1, the important/recent/similar/random selections never take more than the budget, whether or not a selection is skipped; counting the recent leftover twice or allowing ratios above 1 is rejected. |
| `SummarizeLoop.dfy` | Dafny | 5 verified. The HypaV3 summarization loop ends and its token books balance with exactly the chats it dropped, but only with `maxChatsPerSummary >= 1`; with 0 the progress assertion fails (a round drops nothing, the loop spins). Fix: `hypaSettings.ts` clamps the numbers a loaded preset may hold wrongly. |
| `SaveLoad.tla` + the table below | TLC | Saving and loading `database.bin`. See the matrix. |

The Dafny file models the algorithms; it does not verify the TypeScript. Each part is tied to the code by a test:
`src/ts/process/scanWindow.test.ts` (A), `fate-simulator/lint_card.py` replays B on the card, and C was read against
`index.svelte.ts` lines 1157-1167 and the recheck at 1521-1540. Break the model on purpose (change `<=` to `<`, drop the `- 1` in the loop bound,
use the old window formula) and Dafny rejects it.

Run: `dafny verify GenerateContext.dfy`; `java -cp tla2tools.jar tlc2.TLC -metadir /tmp/x -config AssetSweep_FALSE.cfg AssetSweep.tla`.

## SaveLoad.tla: what each fix is needed for

`Atomic` = the server writes through a temp file and a rename. `Strict` = the decoder rejects a torn or incomplete file. `Fallback` = which
backup is used when the file is rejected. Corrupt can tear the file at any time, whatever the server does.

| Atomic | Strict | Fallback | Never loads a partial database | Loads the newest complete version |
| --- | --- | --- | --- | --- |
| no | no | oldest (shipped) | VIOLATED (3 states) | VIOLATED |
| yes | no | oldest | VIOLATED | VIOLATED |
| no | yes | oldest | holds | VIOLATED (the oldest backup wins) |
| no | yes | newest | holds | holds |
| yes | yes | newest | holds | holds |

Code: `server/node/atomicWrite.cjs`, `RisuSaveCorrupt` in `src/ts/storage/risuSave.ts`, the `break` in the two backup loops of `bootstrap.ts`,
`src/ts/storage/backupRetention.ts`. Tests: `src/ts/network/atomicWrite.test.ts` (a reader stress test), `src/ts/storage/risuSaveCorrupt.test.ts`,
`src/ts/storage/backupRetention.test.ts`. The strict decoder was also run against the real `database.bin` and its 20 backups.
