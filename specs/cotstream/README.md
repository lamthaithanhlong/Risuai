# Chain of thought streamed live, in its own panel

The model's reasoning is put into the message as an open `<Thoughts>` block while it is written (`composeStreamChunk`), the thought panel
shows it as it arrives, and the chat shows only the reply (`splitCoT` before the display parser). This checks that doing so is safe.

| File | Tool | Result |
| --- | --- | --- |
| `CotStream.tla` | TLC, `Split = TRUE` | 1296 states, no error. While the model only thinks the chat is empty; the chat parser runs at most once per reply token (`ParserWork`), so thought chunks cost it nothing; the thought block is closed before the first reply token; a reply cut while thinking is stored as "no reply", cut while replying as "partial", a finished one as "final"; the chat and the panel only ever grow. |
| `CotStream.tla` | TLC, `Split = FALSE` | `ParserWork` is violated at the first thought chunk (3 steps): without the split, every thought token re-runs the chat parser, which is why the thought could not be streamed before. |
| `CotSplit.dfy` | Dafny | 17 verified. The splitter as a fold over tokens: whatever has been received is a prefix of what will be received, so the chat text and the thought text only grow (`StreamMonotone`); every character lands in exactly one of them (`NothingLost`); while thinking the chat is empty (`WhileThinking`); once closed the chat shows exactly the reply (`WhileReplying`) and does not depend on the thought (`MainIgnoresThought`); nesting (`NestedBlock`). Four deliberate breaks (a leak into the chat, a dropped character, a close that erases the chat, a close that ends every open block) are each rejected. |

Not covered by the proof, covered by `src/ts/parser/tests/cot.test.ts` instead: the half-tag hold-back at the end of the stream (a lone
`<` may show for one chunk), and `reasoning</think>reply` with the opening tag left out (the text before it moves from chat to panel when
the tag arrives).

Run: `dafny verify CotSplit.dfy`; `java -cp tla2tools.jar tlc2.TLC -deadlock -config X.cfg CotStream.tla` with
`NT = 4 NR = 3 Split = TRUE|FALSE` and `INVARIANTS Bounded ThinkingChatEmpty ParserWork ClosedBeforeReply StoredSound`, `PROPERTY Monotone`.
