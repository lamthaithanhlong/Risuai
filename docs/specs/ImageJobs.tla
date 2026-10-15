----------------------------- MODULE ImageJobs -----------------------------
\* Server picture jobs for one message (imageJobs.cjs + imageJobClient.ts). The page submits job k, waits, and when the job is done
\* puts picture k in the message. The page can die at any step; at its next start it recovers every done, unacked job (puts the
\* picture in, acknowledges). A redraw submits a newer job. ACKFIRST = TRUE: acknowledge, then insert (as built first);
\* FALSE: insert, then acknowledge.
EXTENDS Naturals
CONSTANTS MaxJobs, ACKFIRST, SUPERSEDE
VARIABLES next, done, acked, pic, page, waitingFor, step

vars == <<next, done, acked, pic, page, waitingFor, step>>
Jobs == 1..MaxJobs

Init == /\ next = 1 /\ done = {} /\ acked = {} /\ pic = 0
        /\ page = "up" /\ waitingFor = 0 /\ step = "idle"

\* the page asks for a picture (first draw or a redraw); only when up, idle and recovered
Submit == /\ page = "up" /\ step = "idle" /\ next <= MaxJobs
          /\ waitingFor' = next /\ next' = next + 1 /\ step' = "waiting"
          /\ UNCHANGED <<done, acked, pic, page>>

\* the server finishes a job that was submitted (pages do not need to be up)
Finish(j) == /\ j < next /\ j \notin done
             /\ done' = done \cup {j}
             /\ UNCHANGED <<next, acked, pic, page, waitingFor, step>>

\* SUPERSEDE: the server tells whether a newer job exists for the same message; such a picture is acknowledged, never placed
Superseded(j) == SUPERSEDE /\ \E k \in 1..(next - 1) : k > j
Place(j) == IF Superseded(j) THEN pic ELSE j

\* the waiting page sees its job done: first half of the hand-over
See == /\ page = "up" /\ step = "waiting" /\ waitingFor \in done
       /\ IF ACKFIRST THEN acked' = acked \cup {waitingFor} /\ UNCHANGED pic
                      ELSE pic' = Place(waitingFor) /\ UNCHANGED acked
       /\ step' = "half"
       /\ UNCHANGED <<next, done, page, waitingFor>>

\* second half
Complete == /\ page = "up" /\ step = "half"
            /\ IF ACKFIRST THEN pic' = Place(waitingFor) /\ UNCHANGED acked
                           ELSE acked' = acked \cup {waitingFor} /\ UNCHANGED pic
            /\ step' = "idle" /\ waitingFor' = 0
            /\ UNCHANGED <<next, done, page>>

Crash == /\ page = "up" /\ page' = "down" /\ step' = "idle" /\ waitingFor' = 0
         /\ UNCHANGED <<next, done, acked, pic>>

\* the page starts again: every done, unacked job is put in (newest last) and acknowledged, before anything else
Restart == /\ page = "down"
           /\ LET todo == done \ acked
                 newest == {j \in todo : ~Superseded(j)}
              IN /\ pic' = IF newest = {} THEN pic ELSE CHOOSE j \in newest : \A k \in newest : k <= j
                 /\ acked' = acked \cup todo
           /\ page' = "up"
           /\ UNCHANGED <<next, done, waitingFor, step>>

Next == Submit \/ See \/ Complete \/ Crash \/ Restart \/ \E j \in Jobs : Finish(j)

\* a message never goes back to an older picture than the one it shows
NoRollback == [][pic' = pic \/ pic' > pic]_vars
\* a finished picture is never lost: it is in the message, or a newer one is, or someone still holds it (the waiting page or
\* recovery, i.e. it is unacknowledged)
NotLost == \A j \in done : j <= pic \/ j \notin acked \/ (page = "up" /\ waitingFor = j) \/ Superseded(j)
Spec == Init /\ [][Next]_vars
=============================================================================
