# Soft real time: what the user sees from send to the end of the reply

Measured first (9router -> the provider, a 50 KB prompt, May-October 2026 logs): `main-grok` streams for real (first reasoning delta after 3.1 s, 250 reasoning deltas spread over 53 seconds, but the first reply word only after 119 s of thinking). `main-deepseek` does not stream at all on this route: the headers arrive after 10-18 s and all 870 deltas (298 reasoning, 572 reply) arrive inside the next second. The wait is the router retrying a provider channel that flaps (a direct call to the provider returns 503 in 0.4 s), not generation and not the page. So no client change can show DeepSeek's thought before its reply; what the page can do is say what is happening, and not make the stream slower. It was slower: the old decoder re-parsed the whole buffer on every chunk (239 ms for 900 chunks, 1.2 s for 2 000, 4.6 s for 4 000 on a Mac).

| File | Tool | Result |
| --- | --- | --- |
| `GenStatus.tla` | TLC, `IgnoreStraggler = TRUE` | 230 states, no error: while a request is in flight a phase is always shown and the seconds are current; at most MaxRetry more attempts; phases only move forward (a failed attempt goes back to "retrying"); nothing is shown after the end. |
| `GenStatus.tla` | TLC, `IgnoreStraggler = FALSE` | `NoZombie` is violated in 2 steps: a stream chunk that arrives after the request ended brings the status back and it stays for good. This is why `nextStatus` ignores text when idle. |
| `SseChunks.dfy` | Dafny | 16 verified. SSE framing as a fold: feeding the stream in any pieces gives what feeding it whole gives (`ChunkInvariance`), the events so far only grow (`FeedGrows`, `ReceivedIsPrefix`), an event is added only by the empty line that ends it and never twice (`EventOnlyAtBlankLine`), a half line emits nothing (`HalfLineEmitsNothing`). Four deliberate breaks are each rejected. |

Native `EventSource` cannot be used: it only sends GET, with no headers and no body, and a chat completion is a POST with an Authorization
header. `parse-sse` is 0.1.0 and wants a `Response`. `eventsource-parser` 3.1.1 is a pure parser fed with chunks, so it fits the page's own
stream; `chatStreamDecoder.ts` uses it, and a differential test checks it against the old decoder on 1 000 random streams and cuts.

Run: `dafny verify SseChunks.dfy`; `java -cp tla2tools.jar tlc2.TLC -deadlock -config X.cfg GenStatus.tla` with
`MaxRetry = 2 MaxT = 4 IgnoreStraggler = TRUE|FALSE`, `INVARIANTS TypeOK VisibleWhileInFlight FreshWhileInFlight NoZombie AttemptBound`,
`PROPERTY Forward`.
