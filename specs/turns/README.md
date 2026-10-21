# Turns owned by the server (2026-10-20)

Owner: "input xong gửi xuống queue dựng cờ lên rồi xử lý … model hư, mất mạng, websocket ngắt quá sớm, message xử lý chồng nhau,
racing condition". Before: the page ran the whole turn (helpers, prompt, stream, tidy, Lua triggers, save) and only the model's stream
was a server job. After: `POST /api/turns` makes a turn row (`server/node/turnQueue.cjs`); the server's worker
(`server/node/turnWorker.cjs`) runs it in a headless page of the same client that is never frozen; the player's page only follows it
(`src/ts/process/turnClient.ts`) and takes the saved chat.

States: `queued → assembling → generating → tidying → saved`, `retrying` (model error, cut stream, lost lease: back after 2/8/30/60 s,
same key), `failed` (out of attempts, shown with Gửi lại), `cancelled` (Dừng). One active turn per chat; the rest wait in send order.

## What each model says

| File | Tool | Old (page owns the turn) | New (server owns it) |
| --- | --- | --- | --- |
| `TurnQueue.tla` `_OLD` | TLC | `NoOrphan` violated, 4 states: send → autosave → killed before the resume note → a message nobody answers | holds |
| `_OLD_ONE` | TLC | `OneTurnPerChat` violated: the phone and the Mac each run a turn on one chat | holds |
| `_OLD_RETRY` | TLC | `RetryBeforeGivingUp` violated: one model error ends the turn | holds (3 tries) |
| `_OLD_LIVE` | TLC | `EveryTurnEnds` violated: a frozen page never finishes its turn | holds with fairness for the server only |
| `_OLD_OWNCHAT` | TLC | `ReplyInOwnChat` violated: the resume note names the chat by index; after New Chat it answers another chat | holds (by id) |
| `_OLD_CUT` | TLC | `NoCutAnswer` violated: a stream the model cut is saved as the answer | holds |
| `_OLD_DUP` | TLC | `NoDuplicate`, `ReplyAfterInput` hold (45 144 states) | hold |
| `_NEW_NOCUT` | TLC | — | `NoCutAnswer` violated without `CutOnFail`: two errors then a cut stream, the turn fails with the cut words left in the chat. Found while improving the model; the worker now cuts after the input on any failed run |
| `_NEW_NOACK` | TLC | — | `SavedStays` violated without `SaveAck`: a turn reported saved before its write landed, the next turn's page load drops it. Found by tests/turns double; the worker now asks the server whether the turn's messages are in its save (`inSave`) |
| `TurnQueue_NEW.cfg` | TLC | — | all 8 invariants + liveness hold, 16 462 states |
| `TurnKeys.als` | Alloy | `OneActivePerChat_Old` SAT (counterexample) | `OneActivePerChat`, `OneTurnPerKey`, `FinalStaysFinal`, `InOrder` UNSAT (hold); `RetryThenSaved` SAT (witness) |
| `uppaal/turn_page.xml` | UPPAAL | `A[] not watch.Late` NOT satisfied (phone away 1000 s) | — |
| `uppaal/turn_server.xml` | UPPAAL | — | all three satisfied (lease 60 s, beats 10–25 s, one crash) |
| `uppaal/turn_server_shortlease.xml` | UPPAAL | — | `A[] running <= 1` NOT satisfied: a 20 s lease is taken from a living worker; why the lease is 60 s |
| `TurnApply.dfy` | Dafny | — | 26 verified: apply by id is idempotent and keeps everything else (A), a run again drops only its own partial (B), resume by seq never loses or repeats (C), the chat found by id survives New Chat (D), a failed run leaves nothing after its input (E) |
| `TurnApplyOld.dfy` | Dafny | 2 errors on purpose: `slice(0, previousLength)` drops the Mac's message; the index `chatPage` names another chat after New Chat | — |

## Measured on the code (tests/turns/repro.mjs)

A copy of the live save on its own port, every router request sent to a stub model (server `RISU_UPSTREAM_REMAP`), the page opened as
`phone.localhost` so its model requests go through the server exactly as from the iPhone, iOS suspension emulated by pausing every
script (CDP `Debugger.pause`) and cutting the network for 60 s, 300 ms after send. `Page.setWebLifecycleState frozen` is not that:
measured, fetch callbacks went on and the turn finished while "frozen".

Old build (`~/.backend-review/work/risu-turns/repro-182007.json`):
- freeze: during the 60 s the model got no request and the server did not even have the chat; the turn (29 s of work) ended at +92 s.
- kill (page closed 60 s, opened again): the turn's chat kept an unanswered message for good; the resume answered **another chat**.
- reset (the model dies mid-stream): 55 characters of a cut reply saved as the answer, no error, no retry.
- double (two sends 300 ms apart): both answered in order.

New build, Async turn on (`~/.backend-review/work/risu-turns/repro-20261020-191830.json`):
- freeze: the turn was saved on the server **during** the 60 s away (30 s of work); the page had it at +62.5 s.
- kill: the reply was in the chat on the server while the page was closed.
- reset: the cut stream was retried (`retrying`, attempt 2) and the whole reply saved; no cut words left.
- double: both turns ran in order, but the first reply was lost afterwards. Cause, measured: the live save has
  `enableRemoteSaving` on, so each character (all its chats) is `remotes/<chaId>.local.bin`, written whole by every page, last writer
  wins; the server's three-way merge (dbMerge.cjs) only sees a REMOTE pointer. The phone and the worker are two writers of that file.
  **Async turn stays off (default) until that file is merged per page like database.bin.** The same last-writer-wins already applies
  to the phone and the Mac today.

Also found here and fixed: the lorebook pass read the selected chat, not the reply's (`a854e6d6`, the iPhone crash of 2026-10-20);
a chat both sides added was taken whole from the page and lost the server's reply (dbMerge.cjs); the worker's page reported
"saved" before its write landed (`inSave`).

## Run

`specs/run_all.sh` runs everything here. By hand: `java -cp tla2tools.jar tlc2.TLC -deadlock -config TurnQueue_NEW.cfg TurnQueue.tla`;
`java -jar alloy.jar exec -f TurnKeys.als`; `verifyta -q uppaal/turn_server.xml uppaal/turn.q`; `dafny verify TurnApply.dfy`.
