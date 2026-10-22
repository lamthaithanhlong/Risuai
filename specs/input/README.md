# The chat input: mic, per-chat drafts, chat switch (2026-10-22)

The owner's report: after using the mic the page "is pushed up" on phone and desktop, and with the mic off while a reply generates,
switching chats carried the input box's text into the other chat. Fixed in `src/ts/process/chatDraft.ts` (new),
`src/ts/process/dictation.ts`, `src/lib/ChatScreens/MicButton.svelte`, `src/lib/ChatScreens/DefaultChatScreen.svelte` and
`src/ts/characters.ts`. Tied by `chatDraft.test.ts` and `dictation.test.ts`.

| File | Tool | What it shows |
| --- | --- | --- |
| `Draft.tla` + `Draft_{FIXED,OLD,NOTAG,NOCAPTURE,RETRYWIPE,CLEARALL,NOGUARD}.cfg` | TLC | One box for whichever chat is open; type, dictate (the words come back late), switch, send (awaits a command, the turn check, a trigger, a script), a reply retried or resumed. Each fix is a constant. OLD (all off): `BoxOwned` violated, the owner's leak. FIXED (all on): no error, 4252 states, with `StoreOwned`, `SentOwned`, `SentOnce`, `NoLoss`. Each cfg turns one fix off and shows what it holds up: NOTAG `BoxOwned` (a late dictation lands in the open chat), NOCAPTURE `SentOwned` (sendMain read the box after its awaits and sent another chat's words), RETRYWIPE `NoLoss` (sendChatMainRun cleared the box on a retry or resume), and two TLC found that the first fix still had: CLEARALL `NoLoss` (a send cleared the whole box, losing words typed or dictated during its awaits) and NOGUARD `SentOnce` (a second tap during the awaits sent the text twice). |
| `DraftKey.als` | Alloy 6 | Which chat a draft belongs to. The chat id alone collides across characters (`ChatIdOnly` SAT); the (character, chat) pair still collides when the "all chats" import keeps its ids and runs twice into one character (`PairOldImport` SAT), which is why the importer now gives a repeated id a new one (`PairShipped` UNSAT). A dictation delivered to the open chat lands in the wrong one (`LateOld` SAT); delivered to its tag it never does (`LateShipped`, `BoxIsOpenChat` UNSAT). |
| `DraftKey.dfy` | Dafny | `draftKey`: two different (character, chat) pairs never share a key, for any ids (`DistinctChatsDistinctKeys`, 8 verified), because the encoding leaves no ':' inside a part and is one-to-one. Plain concatenation collides (`NaiveCollides`); with ':' left unescaped the proof fails (2 errors). Writing it turned up that `encodeURIComponent` throws on a lone surrogate: such an id now gets no key instead of breaking the screen. |
| `uppaal/mic_fix{0,1}.xml` + `mic.q` (`mic_template.xml` = fix1) | UPPAAL | The same flow in seconds: recording up to 120 s, `/api/stt` up to 180 s model load + 60 s, a request a phone loses on the way, a reply 7–120 s, retried. FIX=0: `not leak`, `not lost` fail, and the button stays "transcribing" for ever on a lost request (the bound fails). FIX=1: all hold; the page gives up after 300 s (`CLIENT_LIMIT_MS`, past the server's worst case) and says so. The owner's case is reachable in both (`E<> late && genOn`). |

The layout bug needed no model: the box grew to its text with no cap, so a two-minute dictation made it 3376 px tall on an 812 px
phone and pushed the mic and send buttons off the screen. It now stops at 40% of the viewport and scrolls inside
(`inputBoxHeight`); measured in the browser pane at 375×812 (324 px) and desktop (307 px of 768).

Run: `zsh ../run_all.sh`, or `java -cp tla2tools.jar tlc2.TLC -deadlock -config Draft_FIXED.cfg Draft.tla`;
`java -jar alloy.jar exec -f -o /tmp/out DraftKey.als`; `dafny verify DraftKey.dfy`; `verifyta -q uppaal/mic_fix1.xml uppaal/mic.q`.
