# Generation + queue state machine (TLA+ / Alloy)

What these check: one AI reply generation on a phone, through the durable stream-job queue
(`server/node/jobStore.cjs`, `server/node/server.cjs`, `src/ts/network/proxyJobHttp.ts`,
`src/lib/ChatScreens/DefaultChatScreen.svelte`).

| File | Tool | Question |
|---|---|---|
| `GenQueue.tla` + `GenQueue.cfg` | TLC | Under network drops, page refreshes, a server crash, Stop and retries: is every event delivered exactly once and in order, is a reply only ever read from a good job, is cost bounded, and does the owner never stay on "Thinking..." for good? |
| `GenQueueCurrent.cfg` | TLC | Same spec with `FixHttpErr = FALSE` and `FixPartial = FALSE`, i.e. the first version of the server and the page. TLC finds the flaws below. |
| `GenQueuePartial.cfg` | TLC | Only `FixPartial = FALSE`: a half-written reply left in the chat. |
| `GenQueueKill.tla` + `GenQueueKillBefore.cfg` / `GenQueueKillFixed.cfg` | TLC | The page is **killed** mid-reply (Safari swiped away) and reopened later. Adds the autosave lag (`saved` vs `msg`), time (`clock`, marker window `W`, server window `R`) and the three fix flags. `Before` is red, `Fixed` is green. |
| `uppaal/reader_*.xml` + `reader.q` | UPPAAL | Time: a phone locked for minutes while the job finishes. Does the reader give up before it ever reconnects? |
| `GenQueueKeys.als` | Alloy | Keys and jobs over time: never two reusable jobs for one key, a finished job never changes, a failed job is never handed back. |

## Run

The `java` on PATH is 1.8 and cannot run these; use the brew OpenJDK. Do not start the Alloy jar without `exec`
(it opens the GUI and blocks).

```sh
J=/opt/homebrew/opt/openjdk/bin/java
T=~/Downloads/architecture-debug/tla2tools.jar
A=~/Downloads/architecture-debug/alloy/org.alloytools.alloy.dist.jar

$J -cp $T tlc2.TLC -config GenQueue.cfg        -metadir /tmp/tlc1 -workers auto -deadlock GenQueue.tla   # No error
$J -cp $T tlc2.TLC -config GenQueueCurrent.cfg -metadir /tmp/tlc2 -workers 1    -deadlock GenQueue.tla   # ReuseIsNotAReplayOfFailure violated
$J -jar $A exec -f -o /tmp/alloy GenQueueKeys.als    # three checks UNSAT (hold), one run SAT
```

`-deadlock` is needed: when the model has run its course and spent its budget of failures, no action is enabled,
and that is the normal end, not a bug.

### UPPAAL

`verifyta` is vendored in `~/Downloads/architecture-debug/uppaal` (x86_64, runs under Rosetta). The licence key is read
from the owner's own file or Keychain and passed on the command line; it is never printed or committed.

```sh
V=~/Downloads/architecture-debug/uppaal/UPPAAL-5.0.0.app/Contents/Resources/uppaal/bin/verifyta
K="$(cat ~/Downloads/architecture-debug/uppaal-license.key)"
cd uppaal
$V --lease 168 --key "$K" reader_wallclock.xml reader.q   # both NOT satisfied (the old give-up rule)
$V --lease 168 --key "$K" reader_attempts.xml  reader.q   # both satisfied (the fixed rule)
```

`reader_template.xml` is the source; `@FIX@` picks the rule. UPPAAL guards must be convex (no `||` over clocks) and an
urgent edge cannot carry a clock guard, which is why the model has `Failed`/`Check`/`Announce` steps.

### Property test (the code, not the model)

`src/ts/network/proxyJobHttp.property.test.ts` runs `readJobEvents` against 400 random schedules of dropped
connections, replays that overlap, pings, and byte splits that cut a JSON line in two.

## What was found

TLC, first version of the server (`FixHttpErr = FALSE`): the model answers with an HTTP error, the job logs the error
body and `done`, and ends as **done**, which is reusable. A page refresh then replays the error instead of asking
again. Fixed in `runProxyStreamJob`: an upstream status >= 400 marks the job failed (status `error`), so it is not
reused. Covered by `src/ts/network/jobsE2E.test.ts` (run with `RISU_E2E=1`).

TLC, DB message vs stream (`PartialImpliesMarker`): Risu autosaves the chat while a reply streams, so the DB holds
reply text that is only a part. If the page is refreshed with no marker to resume it (expired after 10 minutes, or
cleared by Safari), that half reply stays in the chat as if it were the answer, while the job on the server has the
whole one. Trace: Start, a chunk arrives, the chat is saved with `partial`, Refresh without marker. Fix: the saved
chat itself says it was cut off. Risu clears `isStreaming` in a `finally` block however a reply ends (index.svelte.ts),
so a chat that loads with `isStreaming = true` was cut: `settleChatOnLoad` marks its last bot message
(`src/ts/process/emptyReply.ts`). `isStreaming` is written to the saved database (checked in `save/`).

UPPAAL, first version of the reader: it gave up when `now - lastProgress > 120 s` on the wall clock. A phone locked for
200 s freezes the page, the job finishes at 50 s and waits on the server, and on unlock the clock reads 200 s, so the
reader gave up at its first failure without a single reconnect (`A[] not reader.GaveUp` and `A<> reader.Finished` both
NOT satisfied). Fixed in `readJobEvents`: give up after 30 failed attempts in a row (an event or a ping resets the
count). With that rule both are satisfied. Regression test: the locked-phone case in `proxyJobHttp.test.ts`.

With the fix: 59,962 states, every invariant holds and `Settles` (the message always ends as a reply or a note,
the marker is cleared) holds.

## Limits

Bounded: 4 keys, 2 chunks, 1 network drop, 2 refreshes, 1 crash, 1 retry, 2 generations in a row (670,894 states). Abstracted: the client's "gave up"
is one step to the note; time and the 10-minute marker expiry are a free choice at refresh; one generation at a
time (the app's `doingChat` guarantees that).

### Killed page (GenQueueKill)

```sh
$J -cp $T tlc2.TLC -config GenQueueKillBefore.cfg -metadir /tmp/k1 -workers auto -deadlock GenQueueKill.tla   # violated
$J -cp $T tlc2.TLC -config GenQueueKillFixed.cfg  -metadir /tmp/k2 -workers auto -deadlock GenQueueKill.tla   # No error (893,879 states)
```

Do not raise `NKeys`/`MaxChunks`/`MaxGens` without watching the disk: the first attempt (NKeys=3, MaxChunks=2) wrote 3.4 GB of
states for a single invariant before it was stopped.

Found in the code as it was:

- **The note expired after 10 minutes** (`PENDING_MAX_AGE_MS`) while the server kept a finished job 30 minutes. Reopen
  Safari after 10+ minutes and the reply the server had finished was replaced by "no reply".
  `NoteNeverHidesAFinishedReply` is violated by: send, save, 20 minutes pass, job done, reload.
  Fix: the note lives 48 h, the server reuses a finished job for 24 h (`JOB_REUSE_MAX_AGE_MS`); a test pins note >= server window.
- **The note was cleared before the reply was saved** (`PartialImpliesMarker`): a kill in that gap left a half-written
  reply in the saved chat with no note to finish it. Fix: `await flushSave()` before `clearPending()` (`saveTracker.ts`).
- **A kill in the first second after "send"** (`SentMessageSurvives`): the note was written at once, the chat autosave
  waits 500 ms, so the chat came back without the user's message. Fix: the note carries the user's message and the page
  puts it back (`planResumeWithRestore`).

Each flag was turned off on its own and the matching invariant went red (`W = 1`, `FixFlush = FALSE`, `FixSendText = FALSE`).
`ReplyIsGood` is not in these configs: this module reloads memory from the saved chat without tracking which job a saved
reply came from, so that check would be a modelling artefact; it is covered in `GenQueue.tla`.

### Pure algorithms (Dafny)

`specs/algorithms/Resume.dfy` models four small functions that were only unit-tested on samples: `planResumeWithRestore`,
`nextFlushDelay`, `withRetry` and `shouldWriteBackup`. `dafny verify Resume.dfy` proves for all inputs: a resumed chat always
ends with the user's message at the recorded length; the note's copy is used only when exactly one message is missing; the
repaint delay stays within [base, max] and never shrinks as the cost grows; a retry loop calls `run` at most `delays + 1` times
and succeeds exactly when it fails no more than `delays` times; two backup copies are at least `gap` apart.
Verified 18 / 0 errors; four deliberate breaks (restore when more is missing, no cap, one retry too many, backwards clock) are each
rejected. The model mirrors the TypeScript by hand: the proof is about the model, the unit tests keep the code honest to it.

### Limiter bug found by the proofs (Dafny + Z3)

`specs/algorithms/Limiter.dfy` (0 errors) models `createLimiter` after the fix, `retryDelayMs` (the wait is within (250, 70250] ms,
backs off, and the whole budget is 5 retries) and the empty-reply retry (at most 3 calls). `LimiterOld.dfy` models the limiter as it was:
**Dafny fails it on purpose** (`ArrivePreservesOld`, 1 error). A woken waiter did `running++` a microtask after `release` had already
done `running--`; a call arriving in between took the free slot and the waiter took another, so more than `max` translations ran at once.
Measured in TypeScript before fixing: `limiter.race.test.ts`, seed 1, expected peak 1, got 2. Fixed: `release` hands its slot straight to
the next waiter. `Windows.smt2` (z3) checks the marker window constants: note 48 h, server 24 h, job up to 1 h => no moment where the server
still holds a reply but the note expired (unsat); with note = server window there is one (sat: clock 25 h, job touched at 1 h).

### Overlapping sends (GenerationSlot.dfy)

Found reading `sendChatMain`: `sendChat` refuses a second call while one runs (it returns false), but the second `sendChatMain`
had already replaced the global generation key and counter, overwritten the Stop button's abort controller and the resume note,
and its tail then cleared the key, the note and `doingChat` of the first. A double tap, or the resume effect firing while the
owner sends, left the running reply without its idempotency key and its resume note, and a Stop that aborted nothing. Now
`beginGeneration` claims one slot first and a loser returns without touching anything (`GenerationSlot.dfy`: 7 verified; unit tests in
`generationKey.test.ts`). Not measured on the phone: this is a race read from the code, proved on a model, covered by unit tests.
