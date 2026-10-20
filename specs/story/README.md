# Story cards: the hidden notes and the Future Plan line (2026-10-19)

| File | Tool | What it shows |
| --- | --- | --- |
| `notes_z3.py` | Z3 | Which hidden notes ride on the player's message (`gameMasterPage.ts`). Before the fix (`python3 notes_z3.py`): 4 counterexamples: with the GM switched off the persona and Future Plan notes were gone, on a card with no creation step they never came, and the persona note reached cards that never asked for it. After (`--fixed`, `storyNotesRequest`): 6 of 6 hold, the creation note and a story note never together, none during creation. |
| `plans.dfy` / `plans_window12.dfy` | Dafny | The cards' `status.lua` `dropOldPlans`. The loop over the last 12 messages (`plans_window12.dfy`) fails `DeleteKeepsClean`: a rollback moves the lore pass's window back over a reply the loop never reached. Cleaning every older reply (`plans.dfy`, shipped): 11 verified, no older reply keeps a line, for any scan depth. Tied by each card's `tests/status_test.mjs` (a line 15 messages back). |
| `PlanMerge.als` | Alloy 6 | The line under the per-message chat merge (`ChatMerge.als` `fixed`), desktop and phone on one chat: two devices adding a reply from the same base leave two plan lines (`OnePlanAfterMerge` SAT, a counterexample); the next reply on either device heals it (`HealsOnNextReply` UNSAT). Accepted: for one request both lines' names wake their lore. |

Run: `python3 notes_z3.py [--fixed]`; `dafny verify plans.dfy`; `java -jar alloy.jar exec -f -o /tmp/out PlanMerge.als` (brew OpenJDK).

The models that had no cfg now have `*_FIXED.cfg` (the code's configuration: holds) and `*_OLD.cfg` (the first version: violated)
in their folders (SaveLoad, SaveQueue, CotStream, GenStatus, MergeSave, SlotGeneration, SettleRace; `SettleRace_WITNESS.cfg`
is violated on purpose: a page that really died is still settled). `../run_all.sh` runs every model with its tool.
