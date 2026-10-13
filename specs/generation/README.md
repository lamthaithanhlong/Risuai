# Generation + queue state machine (TLA+ / Alloy)

What these check: one AI reply generation on a phone, through the durable stream-job queue
(`server/node/jobStore.cjs`, `server/node/server.cjs`, `src/ts/network/proxyJobHttp.ts`,
`src/lib/ChatScreens/DefaultChatScreen.svelte`).

| File | Tool | Question |
|---|---|---|
| `GenQueue.tla` + `GenQueue.cfg` | TLC | Under network drops, page refreshes, a server crash, Stop and retries: is every event delivered exactly once and in order, is a reply only ever read from a good job, is cost bounded, and does the owner never stay on "Thinking..." for good? |
| `GenQueueCurrent.cfg` | TLC | Same spec with `FixHttpErr = FALSE` and `FixPartial = FALSE`, i.e. the first version of the server and the page. TLC finds the flaws below. |
| `GenQueuePartial.cfg` | TLC | Only `FixPartial = FALSE`: a half-written reply left in the chat. |
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
