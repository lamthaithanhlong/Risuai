# Pictures as their own pipeline (2026-10-21)

Owner, 2026-10-20: "generate hình trong risu nên để 1 pipeline riêng biệt xử lý không theo pipeline của generate message".
Before: the story card's output trigger (imagegen.lua) called `generateImage(...):await()` and the message turn awaited that trigger, so a
slow, failing or retried picture delayed, failed or re-ran the message turn (the page's and the Async worker's). After: the trigger only
FILES the picture with the server's queue (`POST /api/image-jobs`, a durable row keyed by chat + message + slot) and returns; the server
draws it (own concurrency limit, own retries with a backoff) and puts it into the message BY MESSAGE ID in `remotes/<chaId>.local.bin`.

`PictureQueue.tla` models one chat, turns `1..NT` (one active per chat), the picture rows, a page, and a server restart.

| Config | Tool | Verdict |
| --- | --- | --- |
| `PictureQueue_OLD.cfg` (`Mode = "inline"`: picture inside the turn) | TLC | **`TurnNeverWaitsOnPicture` violated**, 3 steps: the turn asks for its picture and sits in `waitpic` until the picture ended (measured: tests/images/repro.mjs `slow`, turn `generating` for 90 s after the reply was whole) |
| `_OLD_FAIL.cfg` | TLC | **`NoTurnFailedByPicture` violated**, 4 steps: the worker's run timeout fires while the turn waits for the picture, the reply is undone and the turn runs again (measured: `fail`, a 500 from the router retried the turn, because the failed picture's alert is a turn error) |
| `_NEW.cfg` (`Mode = "queue"`) | TLC | **holds**, 186 614 distinct states: `TurnNeverWaitsOnPicture`, `NoTurnFailedByPicture`, `NoWrongPlacement` (a picture is only ever in the message it was drawn for, on the server and in the page), `OneJobPerKey`, `RunningLimit`; temporal `PictureStays` (a placed picture stays), `EveryPictureEnds` (placed, failed for good, or orphan: its message was undone), `EveryTurnEnds` |
| `_NEW_INDEX.cfg` (place in the LAST message, what a naive decoupling of `setChat(-1, ...)` does) | TLC | **`NoWrongPlacement` violated**: a slow picture lands in the next reply |
| `_NEW_LWW.cfg` (the page's write replaces the message, last writer wins) | TLC | **`PictureStays` violated**: the page's older copy erases the placed picture. The server merges a remote file per page and per message (dbSync.cjs, e0472d0a), which is what `pictureQueueServer.test.ts` checks over HTTP |
| `_NEW_NOIDEM.cfg` (no key: a request sent twice is two jobs) | TLC | **`OneJobPerKey` violated** |
| `_NEW_NODURABLE.cfg` (a restart loses the running jobs) | TLC | **`EveryPictureEnds` violated** |

The `_OLD*`, `_NEW_INDEX`, `_NEW_LWW`, `_NEW_NOIDEM` and `_NEW_NODURABLE` configs are RED on purpose (each is the counterexample that
justifies one rule of the new design); `_NEW` is the one that must stay green. `specs/run_all.sh` runs them all; `./run.sh NEW OLD ...` here
runs the named ones.

Fairness is given to the turn pipeline and the server's queue, never to the page (it may stay away). The router fails at most `MaxFail`
times, so a picture that keeps being tried is drawn.

## On the code

`server/node/imageJobs.cjs` (the queue: states, key, limit, backoff, restart, placement), `server/node/pictureText.cjs` (where a picture
goes in a message), `src/ts/process/imageJobClient.ts` (`queuePicture`, `applyPictureJobs`), `pictureWatch.svelte.ts` +
`PictureStatus.svelte` (the status line under a message), tests `src/ts/network/imageJobs.test.ts`, `pictureQueueServer.test.ts`,
`src/ts/process/pictureIndependence.test.ts`, `pictureStatus.test.ts`, `imageJobClient.test.ts`, and the repro `tests/images/repro.mjs`.
