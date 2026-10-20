# Core specs

| File | Tool | What it shows |
| --- | --- | --- |
| `AssetSweep.tla` (+ `_FALSE` / `_TRUE` cfg) | TLC | The startup asset cleanup deleted a file another client was about to reference (5 states). Two strikes holds. Fix: `src/ts/storage/assetSweep.ts`. |
| `GenerateContext.dfy` | Dafny (Z3) | 21 verified. A: the lorebook scan window `slice(length - depth)` loses messages when the chat is shorter than the depth (4 at depth 5 give 1), `lastItems` is exact. B: the lore token budget cut keeps the always-on entries when they come first in priority and fit the budget (the card fix). C: the context truncation loop keeps the newest message, never over-trims, and fails only when the newest message alone does not fit. |
| `MemoryChain.tla` + `MemoryChain_all/none/tail.cfg` | TLC | HypaV3 default (`Clean=all`): deleting one message inside a summarized range drops the whole summary, and the survivors of that range land in neither the context nor a summary (9 states). `none` (preserveOrphanedMemory) and `tail` (the fix: drop orphaned summaries only from the end of the chain) hold over 451 states. Fix: `src/ts/process/memory/hypaOrphans.ts`. |
| `ChatSlot.tla` + `ChatSlot_TRUE/FALSE.cfg` | TLC | `sendChat` keeps `selectedChat` as an index across minutes of awaiting; New Chat does `chats.unshift`, so the reply lands in the wrong chat (3 steps). Following the chat by id holds (134 states). Fix: `src/ts/process/chatSlot.ts`, used for every index in `sendChat`. |
| `MemoryBudget.dfy` | Dafny | 9 verified. HypaV3's memory budget: with recent + similar ratios at most 1, the important/recent/similar/random selections never take more than the budget, whether or not a selection is skipped; counting the recent leftover twice or allowing ratios above 1 is rejected. |
| `SummarizeLoop.dfy` | Dafny | 5 verified. The HypaV3 summarization loop ends and its token books balance with exactly the chats it dropped, but only with `maxChatsPerSummary >= 1`; with 0 the progress assertion fails (a round drops nothing, the loop spins). Fix: `hypaSettings.ts` clamps the numbers a loaded preset may hold wrongly. |
| `HelperCache.tla` + `HelperCache_TRUE/FALSE/FALSE_LIVE.cfg` | TLC | The story helpers (voice, glossary, history TOC) with a model slower than every helper timeout (ChatGPT web). Old code (timeout inside the job): a late answer is dropped, the next turn asks again, so two helper requests for one key are in flight after 4 states (`OneAsk`) and the answer is never kept (`Cached`, 25 states). Fix (`LATE_SAVES`): the job runs to its end and stores the answer, a turn only stops waiting and joins the job in flight; both hold (13 states). Fix: `src/ts/process/helperJob.ts`, tied by `helperJob.test.ts` (the old `storyTermsPage.ts` turns 2 of its 4 tests red). |
| `TocMerge.dfy` | Dafny | 5 verified. A late TOC job's merge keeps every line the chat had, covers each missing message the answer has a line for, and what is still missing only shrinks. Merging into an empty map is rejected (Keep, Shrink). |
| `SaveWatch.tla` / `.dfy` / `.als` | TLC, Dafny, Alloy | The autosave's change effects (`src/ts/storage/saveWatch.svelte.ts`) and the trigger runs that rewrote the card on every chunk. See the section below. |
| `SaveLoad.tla` + the table below | TLC | Saving and loading `database.bin`. See the matrix. |
| `SaveStore.tla` + `SaveStore_TRUE/TWOCLI/NOGUARD/AWAIT.cfg` | TLC | The save in SQLite (`server/node/saveStore.cjs`, `RISU_STORE=sqlite`): no acknowledged change to `database.bin` is lost. Holds (72 states) with the import's read-change-write in one `BEGIN IMMEDIATE` transaction (`store.update`), imports only while the server is stopped with an empty queue (`loreImport.cjs` checks the port, `save.server.pid` and `save.queue.sqlite`), and `/api/write`'s read-merge-enqueue in one event-loop turn. Drop any one and an acknowledged change is lost: two imports read the same bytes (TWOCLI), an import's write is overwritten by a queued page write (NOGUARD, 8 states), an `await` between read and enqueue (AWAIT). Tied to the code by `src/ts/storage/saveStore.test.ts` (4 processes x 60 `update()`s give 240; the same work as read-then-write gives fewer). |

The Dafny file models the algorithms; it does not verify the TypeScript. Each part is tied to the code by a test:
`src/ts/process/scanWindow.test.ts` (A), `fate-simulator/lint_card.py` replays B on the card, and C was read against
`index.svelte.ts` lines 1157-1167 and the recheck at 1521-1540. Break the model on purpose (change `<=` to `<`, drop the `- 1` in the loop bound,
use the old window formula) and Dafny rejects it.

Run: `dafny verify GenerateContext.dfy`; `java -cp tla2tools.jar tlc2.TLC -metadir /tmp/x -config AssetSweep_FALSE.cfg AssetSweep.tla`.

## SaveQueue.tla: the SQLite write queue

`server/node/saveQueue.cjs` (better-sqlite3 for the table, p-queue with concurrency 1 for the worker): /api/write commits the bytes to a table and answers; one worker applies rows in sequence order;
reads and listings look at the table first; one row per key; a failing row is retried with backoff forever and later rows wait for it (still served to readers from the table).
This is the role a Huey queue plays, kept in the Node process that owns the files (Huey is Python and pickles its tasks). The job store (`jobStore.cjs`) uses the same driver, with its multi-statement updates now in transactions. If the native binding is missing after `pnpm install`, run `pnpm rebuild better-sqlite3`.

| InOrder | AssetPolicy | Read returns the last acknowledged write | The directory never regresses | The directory never holds a database without its asset |
| --- | --- | --- | --- | --- |
| yes | ignore (an asset rewritten while pending keeps its place) | holds | holds | holds |
| yes | replace (it moves to the end) | holds | holds | VIOLATED (the database overtakes the asset) |
| no | ignore | holds | holds | VIOLATED |
| yes | ignore, and the worker skips a row that is in backoff | holds | holds | VIOLATED (found by the independent review; the queue now waits for the failing row) |

Tests `src/ts/network/saveQueue.test.ts` (12, including crash recovery with a second instance on the same SQLite file and a random property test).
Found by those tests: sequence numbers were reused after the table emptied, so the worker deleted a newer row that had taken the same number.

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

## SaveWatch: the stutter while playing

The autosave decides what to save with Svelte effects: an effect re-runs when a value it read changes. It used to be one effect that
took `$state.snapshot` of every root setting, of the whole selected character (card, lorebook, scripts: 0.6-1.4 MB on the story
cards) and of all its chats, so any change deep-copied all of it through the state proxies. And on every rendered chunk the card
did change: `runLuaEditTrigger` (`scriptings.ts`) set `lowLevelAccess = false` on the card's stored triggers and `runTrigger`
(`triggers.ts`) set it back to the card's flag, so with a card whose flag is on, one played turn re-ran the card walk 258 times.
Now the triggers are copied, the effects are split (root, card without chats, chats) and walk with `readDeep` instead of copying.

| File | Result |
| --- | --- |
| `SaveWatch.tla` `_FIXED` (Watch=split) | No error, 6,495,714 distinct states: `NoLostChange`, `FlushSound`, `ServerKeepsLoad`, `NoCardWalkOnChat`, `NoRegress`, `EventuallySaved`. |
| `_OLDSAFE` (Watch=one, without the cost invariant) | No error, 64,119 states: the single effect never lost a change either; it was slow, not wrong. |
| `_OLD` (Watch=one) | `NoCardWalkOnChat` violated (116 states): a message re-runs the effect that reads the card. |
| `_OPENONLY` (walk only the open chat) | `FlushSound` violated: a reply that lands in another chat (`chatSlot.ts`) is never saved while flush says it is. |
| `_EARLY` (saveDb before the load) | `ServerKeepsLoad` violated: the empty page is written over the full save. `bootstrap.ts` starts `saveDb()` only after `loadData` set the database. |
| `SaveWatch.dfy` | 27 verified. A: the `readDeep` stack loop ends and visits exactly the objects and arrays under the root (skip the last child and Dafny rejects the loop). B: every root/card/chat part is read by an effect that reports its block; the card effect reads no chat; the open-chat-only split misses another chat. C: the old trigger maps flip the stored card; the copies leave it as it was. |
| `SaveWatch.als` | Scope 7: `SplitCovered`, `SplitDisjoint`, `SplitCardAlone` have no counterexample; `OpenOnlyCovered` has one (a message in a chat that is not open); `ShowSplit` finds an instance (the model is not vacuous). |

Tied to the code by `src/ts/storage/saveWatch.svelte.test.ts` (7 tests on real `$state` with `flushSync`, including a fast-check
property; making the card effect read the chats, or the chats effect walk only the open chat, turns them red) and the semgrep rule
`mutate-stored-card-in-map` in `specs/review/semgrep-rules.yml` (2 findings on the old `scriptings.ts:1430` and `triggers.ts:1083`,
0 now). Measured with `node tests/acceptance/jank.mjs` on a copy of the save (numbers in the commit message).
