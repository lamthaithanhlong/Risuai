---- MODULE GenStatus ----
\* The status line shown from pressing send to the end of the reply (src/ts/process/genStatus.svelte.ts, GenStatusLine.svelte).
\* IgnoreStraggler = TRUE : a stream chunk that arrives after the request ended changes nothing
\* IgnoreStraggler = FALSE: such a chunk brings the status back (the first version)
EXTENDS Naturals

CONSTANTS MaxRetry, MaxT, IgnoreStraggler

VARIABLES phase, inflight, attempt, now, started, shown

vars == <<phase, inflight, attempt, now, started, shown>>

Rank(p) == CASE p = "idle" -> 0 [] p = "sent" -> 1 [] p = "retrying" -> 1 [] p = "accepted" -> 2 [] p = "thinking" -> 3 [] p = "writing" -> 4

Init == /\ phase = "idle" /\ inflight = FALSE /\ attempt = 0 /\ now = 0 /\ started = 0
        /\ shown = [phase |-> "idle", secs |-> 0]

\* the page redraws the line (the one second timer); it is part of every step that changes the phase
Draw(p, n) == shown' = [phase |-> p, secs |-> IF p = "idle" THEN 0 ELSE n - started]

Send == /\ ~inflight /\ inflight' = TRUE /\ phase' = "sent" /\ attempt' = 1 /\ started' = now /\ UNCHANGED now
        /\ shown' = [phase |-> "sent", secs |-> 0]
\* the provider failed before any byte: send again, up to MaxRetry more times, else give up (the error popup)
Fail   == /\ phase \in {"sent", "retrying"} /\ attempt <= MaxRetry
          /\ phase' = "retrying" /\ attempt' = attempt + 1 /\ UNCHANGED <<inflight, now, started>> /\ Draw("retrying", now)
GiveUp == /\ phase \in {"sent", "retrying"} /\ attempt > MaxRetry
          /\ phase' = "idle" /\ inflight' = FALSE /\ UNCHANGED <<attempt, now, started>> /\ Draw("idle", now)
Accept == /\ phase \in {"sent", "retrying"} /\ phase' = "accepted" /\ UNCHANGED <<inflight, attempt, now, started>> /\ Draw("accepted", now)
Think  == /\ phase \in {"accepted", "thinking"} /\ phase' = "thinking" /\ UNCHANGED <<inflight, attempt, now, started>> /\ Draw("thinking", now)
Reply  == /\ phase \in {"accepted", "thinking", "writing"} /\ phase' = "writing" /\ UNCHANGED <<inflight, attempt, now, started>> /\ Draw("writing", now)
\* finished, failed after bytes, cut, or aborted: the chat screen's single exit
End    == /\ inflight /\ inflight' = FALSE /\ phase' = "idle" /\ UNCHANGED <<attempt, now, started>> /\ Draw("idle", now)
\* a chunk shows up after the end
Straggler == /\ ~inflight /\ phase = "idle"
             /\ IF IgnoreStraggler THEN UNCHANGED vars
                ELSE /\ phase' = "writing" /\ UNCHANGED <<inflight, attempt, now, started>> /\ Draw("writing", now)
Tick   == /\ now < MaxT /\ now' = now + 1 /\ UNCHANGED <<phase, inflight, attempt, started>>
          /\ shown' = [phase |-> phase, secs |-> IF phase = "idle" THEN 0 ELSE now' - started]

Next == Send \/ Fail \/ GiveUp \/ Accept \/ Think \/ Reply \/ End \/ Straggler \/ Tick
Spec == Init /\ [][Next]_vars

TypeOK == /\ phase \in {"idle", "sent", "retrying", "accepted", "thinking", "writing"} /\ attempt <= MaxRetry + 1
\* while a request is in flight the user always sees what it is doing
VisibleWhileInFlight == inflight => (phase # "idle" /\ shown.phase = phase)
\* the line is never stale: the seconds shown are the seconds elapsed
FreshWhileInFlight == inflight => shown.secs = now - started
\* nothing in flight, nothing shown (no zombie status after the end)
NoZombie == ~inflight => (phase = "idle" /\ shown.phase = "idle")
\* at most MaxRetry more attempts
AttemptBound == attempt <= MaxRetry + 1
\* phases only move forward, except that a failed attempt goes back to retrying and a new send starts again
Forward == [][ \/ phase' = phase \/ Rank(phase') >= Rank(phase) \/ phase' = "idle" ]_vars
====
