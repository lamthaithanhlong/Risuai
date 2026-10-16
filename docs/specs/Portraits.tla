------------------------------ MODULE Portraits ------------------------------
\* One character's portrait (src/ts/process/portraits.ts drawNewPortraits). A reply describing them asks for a drawing unless
\* one is drawn or being drawn; a drawing lost with a closed page is retried once it is stale (10 min), while the first may still
\* finish; the learner may add their own picture under that name. Checked with TLC, 2026-10-15:
\*   OneAssetPerName   never two Additional Assets for one character
\*   HandStays         a picture the learner added is never replaced
\* FIXED = FALSE pushes the asset without looking for one of that name: a stale retry and the first drawing both land.
EXTENDS Naturals
CONSTANTS FIXED, MaxDraws
VARIABLES state, inflight, assets, hand, stale, draws
vars == <<state, inflight, assets, hand, stale, draws>>

Init == state = "none" /\ inflight = 0 /\ assets = 0 /\ hand = FALSE /\ stale = FALSE /\ draws = 0

Reply == /\ draws < MaxDraws
         /\ (state \in {"none", "error"} \/ (state = "pending" /\ stale))
         /\ state' = "pending" /\ stale' = FALSE /\ inflight' = inflight + 1 /\ draws' = draws + 1
         /\ UNCHANGED <<assets, hand>>

Finish(ok) == /\ inflight > 0
              /\ inflight' = inflight - 1
              /\ IF ok THEN /\ assets' = IF FIXED /\ assets > 0 THEN assets ELSE assets + 1
                            /\ state' = "done"
                       ELSE /\ assets' = assets /\ state' = "error"
              /\ UNCHANGED <<hand, stale, draws>>

Close == inflight > 0 /\ inflight' = 0 /\ UNCHANGED <<state, assets, hand, stale, draws>>       \* the page goes, its waits with it
Late  == state = "pending" /\ stale' = TRUE /\ UNCHANGED <<state, inflight, assets, hand, draws>>
Hand  == assets = 0 /\ ~hand /\ assets' = 1 /\ hand' = TRUE /\ UNCHANGED <<state, inflight, stale, draws>>

Next == Reply \/ Finish(TRUE) \/ Finish(FALSE) \/ Close \/ Late \/ Hand

OneAssetPerName == assets <= 1
HandStays == hand => assets = 1
=============================================================================
