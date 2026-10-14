# Model slots

Up to 4 named model choices (settings: Chat Bot > Model > Model slots), one in use, picked from the chat input menu. A slot is applied by writing
the two fields the request code already reads (`aiModel`, `customProxyRequestModel`), so no request code path changed except the one
below.

| File | Tool | Result |
| --- | --- | --- |
| `ModelSlots.dfy` | Dafny | 20 verified. Every operation (add, add from current, remove, select, edit, a direct edit of the model fields, load) keeps the state valid: at most 4 slots, unique non-empty ids, the active id names a slot, the model fields agree with it. `Normalize` makes ANY stored data valid. Six deliberate breaks (dangling active id, select not writing the fields, no cap, no detach on a direct edit, trusting a stale active id, duplicate ids) are each rejected. |
| `ModelSlots.als` | Alloy 6 | The four operations keep the state valid in every state of the bound. Three weaker designs have counterexamples: removing the active slot but keeping it active, a direct edit that leaves the slot active, and a stored root that takes the slot list from one writer and the model fields from another. So all four fields live in the root block, which Risu saves whole. |
| `SlotGeneration.tla` | TLC | One generation can build several requests (empty-reply and guard retries each start over and re-read the settings). Without a guard, or with only the chat picker disabled, one reply can use two different models. It holds only if both the picker and the settings page are blocked during a generation, or if the generation takes its model once at the start. The app does the latter (`generationKey.ts`, read by `request.ts`), so switching a slot while a reply runs affects the next message only. |

Code: `src/ts/model/modelSlots.ts` (the pure port of the Dafny file, with a property test over random sequences, six mutants killed),
`modelSlotsRuntime.svelte.ts` (applies it to the database; a watcher detaches the active slot when something else changes the model fields),
`src/lib/Setting/Pages/ModelSlotsSettings.svelte`, `src/lib/ChatScreens/ModelSlotPicker.svelte`. The database load normalizes stored slots.

Run: `dafny verify ModelSlots.dfy`; `java -jar alloy.jar exec -f -o /tmp/out ModelSlots.als`;
`java -cp tla2tools.jar tlc2.TLC -deadlock -config X.cfg SlotGeneration.tla` with `GuardPicker`, `GuardSetting`, `Snapshot` as in the header.
