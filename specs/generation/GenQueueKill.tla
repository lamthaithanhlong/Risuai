--------------------------- MODULE GenQueueKill ---------------------------
(***************************************************************************)
(* GenQueue.tla plus the case it leaves out: the page is KILLED while a    *)
(* reply is generating (Safari swiped away) and opened again later.        *)
(*                                                                         *)
(*  saved  : the chat as persisted on the server. The page's memory (msg)  *)
(*           runs ahead of it: autosave is debounced, so a killed page     *)
(*           comes back with whatever was last saved, not what it showed.  *)
(*  clock  : minutes pass. The marker in localStorage is trusted for W     *)
(*           ticks; the server reuses a job for R ticks.                   *)
(*  marker : localStorage, written at once, survives the kill.             *)
(*                                                                         *)
(* Fix flags (all FALSE / short = the code as it was before this model):   *)
(*  FixFlush    the marker is cleared only after the reply is saved        *)
(*  FixSendText the marker carries the sent text, so a send that never     *)
(*              reached the saved chat is still answered                   *)
(*  W = MaxTime the marker has no client-side expiry; the server decides   *)
(*                                                                         *)
(* Source: server/node/jobStore.cjs, server/node/server.cjs,               *)
(* src/ts/process/pendingGeneration*.ts, src/ts/globalApi.svelte.ts        *)
(* (saveDb: 500 ms debounce), DefaultChatScreen.svelte (sendChatMain).     *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS NKeys, MaxChunks, MaxDrops, MaxRefresh, MaxCrash, MaxRetry, MaxGens, FixHttpErr, FixPartial,
          MaxTime, W, R, FixFlush, FixSendText

Keys     == 1..NKeys
Reusable == {"running", "done"}
Gen      == {"placeholder", "partial"}
Msgs     == {"none", "placeholder", "partial", "reply", "note"}

VARIABLES
    net, srv, st, log, outcome, calls, interrupted, jobAt,
    msg, saved, replyKey, key, cur, got, marker, retries,
    drops, refreshes, crashes, gens, clock, mAt, closed

serverVars == <<st, log, outcome, calls, interrupted, jobAt>>
clientVars == <<key, cur, got>>
envVars    == <<drops, refreshes, crashes, gens>>
timeVars   == <<clock, mAt>>
vars       == <<net, srv, st, log, outcome, calls, interrupted, jobAt, msg, saved, replyKey, key, cur, got, marker, retries,
                drops, refreshes, crashes, gens, clock, mAt, closed>>

Init ==
    /\ net = "up" /\ srv = "up"
    /\ st = [k \in Keys |-> "none"] /\ log = [k \in Keys |-> <<>>]
    /\ outcome = [k \in Keys |-> "ok"] /\ calls = [k \in Keys |-> 0]
    /\ interrupted = [k \in Keys |-> FALSE] /\ jobAt = 0
    /\ msg = "none" /\ saved = "none" /\ replyKey = 0
    /\ key = 1 /\ cur = 1 /\ got = <<>>
    /\ marker = FALSE /\ retries = 0
    /\ drops = 0 /\ refreshes = 0 /\ crashes = 0 /\ gens = 0
    /\ clock = 0 /\ mAt = 0 /\ closed = FALSE

TypeOK ==
    /\ net \in {"up", "down"} /\ srv \in {"up", "down"}
    /\ st \in [Keys -> {"none", "running", "done", "error", "aborted", "interrupted"}]
    /\ msg \in Msgs /\ saved \in Msgs
    /\ key \in Keys /\ cur \in Nat /\ clock \in 0..MaxTime

---------------------------------------------------------------------------
(* POST /proxy-stream-jobs with idempotency key k: reuse a running/done job that is recent enough, else start one *)
Post(k) ==
    IF st[k] \in Reusable /\ clock - jobAt <= R
    THEN UNCHANGED serverVars
    ELSE \E o \in {"ok", "httpErr"} :
            /\ st'          = [st EXCEPT ![k] = "running"]
            /\ log'         = [log EXCEPT ![k] = <<>>]
            /\ outcome'     = [outcome EXCEPT ![k] = o]
            /\ calls'       = [calls EXCEPT ![k] = @ + 1]
            /\ interrupted' = [interrupted EXCEPT ![k] = FALSE]
            /\ jobAt'       = clock

Start ==
    /\ msg = "none" /\ net = "up" /\ srv = "up"
    /\ msg' = "placeholder" /\ replyKey' = 0
    /\ key' = 1 /\ cur' = 1 /\ got' = <<>>
    /\ marker' = TRUE /\ retries' = 0
    /\ Post(1)
    /\ gens' = 1 /\ mAt' = clock /\ closed' = FALSE
    /\ UNCHANGED <<net, srv, drops, refreshes, crashes, saved, clock>>

NewGen ==
    /\ msg \in {"reply", "note"} /\ ~marker /\ gens < MaxGens /\ key < NKeys
    /\ net = "up" /\ srv = "up"
    /\ msg' = "placeholder" /\ replyKey' = 0
    /\ key' = key + 1 /\ cur' = 1 /\ got' = <<>>
    /\ marker' = TRUE /\ retries' = 0
    /\ Post(key + 1)
    /\ gens' = gens + 1 /\ mAt' = clock /\ closed' = FALSE
    /\ UNCHANGED <<net, srv, drops, refreshes, crashes, saved, clock>>

(* autosave: the persisted chat catches up with the page *)
Save ==
    /\ saved # msg /\ net = "up" /\ srv = "up"
    /\ saved' = msg
    /\ UNCHANGED <<net, srv, serverVars, msg, replyKey, clientVars, marker, retries, envVars, clock, mAt, closed>>

(* time passes *)
Tick ==
    /\ clock < MaxTime /\ clock' = clock + 1
    /\ UNCHANGED <<net, srv, serverVars, msg, saved, replyKey, clientVars, marker, retries, envVars, mAt, closed>>

---------------------------------------------------------------------------
Upstream(k) ==
    /\ srv = "up" /\ st[k] = "running"
    /\ LET n == Len(log[k]) IN
       \/ /\ outcome[k] = "ok" /\ n < MaxChunks
          /\ log' = [log EXCEPT ![k] = Append(@, "c")] /\ UNCHANGED st
       \/ /\ outcome[k] = "ok" /\ n = MaxChunks
          /\ log' = [log EXCEPT ![k] = Append(@, "d")] /\ st' = [st EXCEPT ![k] = "done"]
       \/ /\ outcome[k] = "httpErr" /\ n = 0
          /\ log' = [log EXCEPT ![k] = Append(@, "x")] /\ UNCHANGED st
       \/ /\ outcome[k] = "httpErr" /\ n = 1
          /\ log' = [log EXCEPT ![k] = Append(@, "d")]
          /\ st'  = [st EXCEPT ![k] = IF FixHttpErr THEN "error" ELSE "done"]
    /\ jobAt' = IF k = key THEN clock ELSE jobAt
    /\ UNCHANGED <<net, srv, outcome, calls, interrupted, msg, saved, replyKey, clientVars, marker, retries, envVars, timeVars, closed>>

Read ==
    /\ msg \in Gen /\ net = "up" /\ srv = "up"
    /\ st[key] # "none" /\ cur <= Len(log[key])
    /\ LET ev == log[key][cur]
           g2 == Append(got, ev)
           ok == (\E i \in 1..Len(g2) : g2[i] = "c") /\ ~(\E i \in 1..Len(g2) : g2[i] = "x")
       IN
       /\ IF ev \notin {"d", "e"}
          THEN /\ got' = g2 /\ cur' = cur + 1
               /\ msg' = IF ev = "c" THEN "partial" ELSE msg
               /\ UNCHANGED <<replyKey, key, marker, retries, serverVars, mAt>>
          ELSE IF ev = "d" /\ ok
          THEN /\ msg' = "reply" /\ replyKey' = key
               /\ got' = g2 /\ cur' = cur + 1
               /\ UNCHANGED <<key, marker, retries, serverVars, mAt>>
          ELSE IF retries < MaxRetry /\ key < NKeys
          THEN /\ key' = key + 1 /\ retries' = retries + 1
               /\ cur' = 1 /\ got' = <<>>
               /\ Post(key + 1)
               /\ msg' = "placeholder"
               /\ mAt' = clock
               /\ UNCHANGED <<replyKey, marker>>
          ELSE /\ msg' = "note"
               /\ got' = g2 /\ cur' = cur + 1
               /\ UNCHANGED <<key, retries, replyKey, serverVars, marker, mAt>>
    /\ UNCHANGED <<net, srv, envVars, saved, clock, closed>>

(* sendChatMain returns: the marker is cleared. FixFlush: only once the chat on the server holds the reply *)
ClearMarker ==
    /\ marker /\ msg \in {"reply", "note"}
    /\ (~FixFlush \/ saved = msg)
    /\ marker' = FALSE
    /\ UNCHANGED <<net, srv, serverVars, msg, saved, replyKey, clientVars, retries, envVars, timeVars, closed>>

(* The reader gave up: the connection stayed lost too long. The marker stays until ClearMarker. *)
GaveUp ==
    /\ msg \in Gen /\ (net = "down" \/ srv = "down")
    /\ msg' = "note" /\ closed' = TRUE
    /\ UNCHANGED <<net, srv, serverVars, saved, replyKey, clientVars, marker, retries, envVars, timeVars>>

Stop ==
    /\ msg \in Gen /\ net = "up" /\ srv = "up"
    /\ msg' = "note" /\ closed' = TRUE
    /\ st' = [st EXCEPT ![key] = IF @ = "running" THEN "aborted" ELSE @]
    /\ UNCHANGED <<net, srv, log, outcome, calls, interrupted, jobAt, saved, replyKey, clientVars, marker, retries, envVars, timeVars>>

---------------------------------------------------------------------------
NetDrop ==
    /\ net = "up" /\ drops < MaxDrops
    /\ net' = "down" /\ drops' = drops + 1
    /\ UNCHANGED <<srv, serverVars, msg, saved, replyKey, clientVars, marker, retries, refreshes, crashes, gens, timeVars, closed>>

NetUp ==
    /\ net = "down" /\ net' = "up"
    /\ UNCHANGED <<srv, serverVars, msg, saved, replyKey, clientVars, marker, retries, envVars, timeVars, closed>>

Crash ==
    /\ srv = "up" /\ crashes < MaxCrash
    /\ srv' = "down" /\ crashes' = crashes + 1
    /\ UNCHANGED <<net, serverVars, msg, saved, replyKey, clientVars, marker, retries, drops, refreshes, gens, timeVars, closed>>

Restart ==
    /\ srv = "down" /\ srv' = "up"
    /\ st'          = [k \in Keys |-> IF st[k] = "running" THEN "interrupted" ELSE st[k]]
    /\ log'         = [k \in Keys |-> IF st[k] = "running" THEN Append(log[k], "e") ELSE log[k]]
    /\ interrupted' = [k \in Keys |-> IF st[k] = "running" THEN TRUE ELSE interrupted[k]]
    /\ jobAt' = clock
    /\ UNCHANGED <<net, outcome, calls, msg, saved, replyKey, clientVars, marker, retries, envVars, timeVars, closed>>

(* The page was killed and is opened again (needs the network and the server).
   Its memory is gone: the chat comes back as SAVED. The marker is whatever localStorage holds.
     A  the marker is trusted (age <= W) and the chat holds the user's message (or the marker carries the text):
        drop whatever follows it and ask the job again with the same key.
     B  no trusted marker and the chat was left mid-reply: settle it with a note.
     C  nothing to resume. *)
Refresh ==
    /\ net = "up" /\ srv = "up" /\ refreshes < MaxRefresh
    /\ refreshes' = refreshes + 1
    /\ cur' = 1 /\ got' = <<>>
    /\ LET L     == saved
           valid == marker /\ clock - mAt <= W
       IN
       \/ /\ valid /\ (L # "none" \/ FixSendText)
          /\ msg' = "placeholder" /\ saved' = L /\ replyKey' = 0
          /\ Post(key) /\ mAt' = clock
          /\ UNCHANGED <<key, marker, retries, closed>>
       \/ /\ ~valid /\ L \in Gen
          /\ msg' = IF L = "partial" /\ ~FixPartial THEN "partial" ELSE "note"
          /\ saved' = L /\ marker' = FALSE
          /\ UNCHANGED <<serverVars, replyKey, key, retries, mAt, closed>>
       \/ /\ (~valid /\ L \notin Gen) \/ (valid /\ L = "none" /\ ~FixSendText)
          /\ msg' = L /\ saved' = L /\ marker' = FALSE
          /\ UNCHANGED <<serverVars, replyKey, key, retries, mAt, closed>>
    /\ UNCHANGED <<net, srv, drops, crashes, gens, clock>>

Next ==
    \/ Start \/ NewGen \/ Read \/ ClearMarker \/ GaveUp \/ Stop \/ Save \/ Tick
    \/ \E k \in Keys : Upstream(k)
    \/ NetDrop \/ NetUp \/ Crash \/ Restart \/ Refresh

Spec == Init /\ [][Next]_vars
         /\ WF_vars(Start) /\ WF_vars(NewGen) /\ WF_vars(Read) /\ WF_vars(ClearMarker) /\ WF_vars(Save)
         /\ \A k \in Keys : WF_vars(Upstream(k))
         /\ WF_vars(NetUp) /\ WF_vars(Restart)

---------------------------------------------------------------------------
(* SAFETY *)

NoLossNoDup ==
    (msg \in Gen /\ st[key] # "none") => got = SubSeq(log[key], 1, cur - 1)

PartialImpliesMarker ==
    (msg = "partial" \/ saved = "partial") => marker

ReplyIsGood ==
    msg = "reply" => /\ replyKey \in Keys
                     /\ outcome[replyKey] = "ok"
                     /\ \E i \in 1..Len(log[replyKey]) : log[replyKey][i] = "c"

ReuseIsNotAReplayOfFailure ==
    \A k \in Keys : (st[k] \in Reusable /\ outcome[k] = "httpErr") => st[k] = "running"

DeadJobsAreNotReusable ==
    \A k \in Keys : st[k] \in {"interrupted", "aborted", "error"} => st[k] \notin Reusable

KeysNeverShared == gens <= NKeys

CostBound ==
    \A k \in Keys : calls[k] <= 1 + crashes + refreshes

(* THE KILL PROPERTIES *)

(* A reply the server finished and still holds is never turned into a "no reply" note by a reload the owner did not ask for *)
NoteNeverHidesAFinishedReply ==
    (msg = "note" /\ ~closed /\ clock - jobAt <= R) => ~(st[key] = "done" /\ outcome[key] = "ok")

(* Once a message was sent it does not vanish: a reload never brings back a chat without it *)
SentMessageSurvives ==
    gens >= 1 => msg # "none"

---------------------------------------------------------------------------
Settles == <>[](msg \in {"none", "reply", "note"} /\ ~marker)

=============================================================================
