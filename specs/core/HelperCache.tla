------------------------------ MODULE HelperCache ------------------------------
\* The story helpers (voice profile, glossary, history TOC): each turn needs a helper answer that is kept with the card or chat.
\* A turn waits for the helper at most a timeout. With the ChatGPT web model a helper turn takes minutes, longer than every
\* timeout (30-90 s), so the answer always comes after the turn stopped waiting (owner, 2026-10-19: "web bị đơ").
\*   LATE_SAVES = FALSE  the old code: the timeout is inside the job, so a late answer is dropped and the next turn asks again.
\*   LATE_SAVES = TRUE   the fix: the job runs to its end and stores the answer; a turn only stops waiting; the next turn
\*                       reuses the job still in flight instead of starting another one.
\* Properties: OneAsk (never two helper requests for the same key in flight: each one is a ChatGPT web turn, and the account
\* runs at most 5 at once), Cached (the answer is eventually kept, so turns stop paying for it).
EXTENDS Naturals

CONSTANTS LATE_SAVES, MaxTurns

VARIABLES cached,   \* the answer is kept with the card
          inflight, \* helper requests sent and not answered yet
          waiting,  \* the current turn is waiting for the helper
          turns     \* turns started

vars == <<cached, inflight, waiting, turns>>

Init == cached = FALSE /\ inflight = 0 /\ waiting = FALSE /\ turns = 0

\* A turn starts. With the answer kept it needs nothing. Otherwise it waits, sending a request unless (fix) one is in flight.
StartTurn ==
    /\ ~waiting /\ turns < MaxTurns
    /\ turns' = turns + 1
    /\ IF cached
         THEN UNCHANGED <<cached, inflight, waiting>>
         ELSE /\ waiting' = TRUE
              /\ inflight' = IF LATE_SAVES /\ inflight > 0 THEN inflight ELSE inflight + 1
              /\ UNCHANGED cached

\* The turn stops waiting (the timeout). The request is not cancelled: Promise.race does not abort the fetch.
Timeout == waiting /\ waiting' = FALSE /\ UNCHANGED <<cached, inflight, turns>>

\* A helper answer arrives. Old code: kept only while the turn still waits. Fix: always kept.
Answer ==
    /\ inflight > 0
    /\ inflight' = inflight - 1
    /\ cached' = (cached \/ waiting \/ LATE_SAVES)
    /\ waiting' = FALSE
    /\ UNCHANGED turns

\* The ChatGPT web model is slower than every timeout: a waiting turn always times out before the answer comes.
SlowAnswer == ~waiting /\ Answer

Next == StartTurn \/ Timeout \/ SlowAnswer

Spec == Init /\ [][Next]_vars /\ WF_vars(Timeout) /\ WF_vars(SlowAnswer) /\ WF_vars(StartTurn)

OneAsk == inflight <= 1
Cached == <>cached

=============================================================================
