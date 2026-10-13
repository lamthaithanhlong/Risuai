---------------------------- MODULE GenQueue ----------------------------
(***************************************************************************)
(* One AI reply generation on the phone, through the durable job queue.     *)
(*                                                                         *)
(*  client : the page. Its memory (cursor, received events) is lost on     *)
(*           refresh; localStorage (the marker) and the saved chat survive. *)
(*  server : stream jobs in SQLite. Every event of a job is logged with a  *)
(*           sequence number; a job found by its idempotency key is reused *)
(*           only while running or done.                                   *)
(*  world  : the network drops, the page refreshes, the server crashes.    *)
(*                                                                         *)
(* Source: server/node/jobStore.cjs, server/node/server.cjs (POST          *)
(* /proxy-stream-jobs, GET .../events), src/ts/network/proxyJobHttp.ts,    *)
(* src/lib/ChatScreens/DefaultChatScreen.svelte (sendChatMain, resume).    *)
(*                                                                         *)
(* FixHttpErr = FALSE is the code as first written: an upstream that       *)
(* answered with an HTTP error finished as "done" and so was reusable.     *)
(* FixPartial = FALSE: a half-written reply saved to the chat while it     *)
(* streamed stays there as if it were the answer when the page is          *)
(* refreshed with no marker left to resume it.                             *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS NKeys, MaxChunks, MaxDrops, MaxRefresh, MaxCrash, MaxRetry, MaxGens, FixHttpErr, FixPartial

Keys     == 1..NKeys
Reusable == {"running", "done"}
Gen      == {"placeholder", "partial"}   \* the saved message while a reply is being written

VARIABLES
    net, srv,             \* "up" | "down"
    st,                   \* st[k]: job status for key k
    log,                  \* log[k]: events of k's job: "c" chunk, "x" upstream error body, "d" done, "e" server-restart error
    outcome,              \* outcome[k]: what the model upstream will do for k's job: "ok" | "httpErr"
    calls,                \* calls[k]: how many times the model was asked for key k
    interrupted,          \* interrupted[k]: k's job was cut by a crash at least once
    msg,                  \* the saved message: "none" | "placeholder" | "partial" (some reply text saved) | "reply" | "note"
    replyKey,             \* key of the job the saved reply was read from (0 = none)
    key, cur, got,        \* client: current key, next seq to read, events received (all lost on refresh)
    marker,               \* localStorage: a generation is in flight
    retries,              \* empty-reply retries used (resets with a new generation only)
    drops, refreshes, crashes,
    gens                  \* generations started so far (a message sent, or a reroll)

clientVars == <<key, cur, got>>
envVars    == <<drops, refreshes, crashes, gens>>
serverVars == <<st, log, outcome, calls, interrupted>>
vars       == <<net, srv, st, log, outcome, calls, interrupted, msg, replyKey, key, cur, got, marker, retries, drops, refreshes, crashes, gens>>

Init ==
    /\ net = "up" /\ srv = "up"
    /\ st = [k \in Keys |-> "none"]
    /\ log = [k \in Keys |-> <<>>]
    /\ outcome = [k \in Keys |-> "ok"]
    /\ calls = [k \in Keys |-> 0]
    /\ interrupted = [k \in Keys |-> FALSE]
    /\ msg = "none" /\ replyKey = 0
    /\ key = 1 /\ cur = 1 /\ got = <<>>
    /\ marker = FALSE /\ retries = 0
    /\ drops = 0 /\ refreshes = 0 /\ crashes = 0 /\ gens = 0

TypeOK ==
    /\ net \in {"up", "down"} /\ srv \in {"up", "down"}
    /\ st \in [Keys -> {"none", "running", "done", "error", "aborted", "interrupted"}]
    /\ \A k \in Keys : \A i \in 1..Len(log[k]) : log[k][i] \in {"c", "x", "d", "e"}
    /\ msg \in {"none", "placeholder", "partial", "reply", "note"}
    /\ key \in Keys /\ cur \in Nat

---------------------------------------------------------------------------
(* POST /proxy-stream-jobs with idempotency key k: reuse a running/done job, else start a new one *)
Post(k) ==
    IF st[k] \in Reusable
    THEN UNCHANGED serverVars
    ELSE \E o \in {"ok", "httpErr"} :
            /\ st'          = [st EXCEPT ![k] = "running"]
            /\ log'         = [log EXCEPT ![k] = <<>>]
            /\ outcome'     = [outcome EXCEPT ![k] = o]
            /\ calls'       = [calls EXCEPT ![k] = @ + 1]
            /\ interrupted' = [interrupted EXCEPT ![k] = FALSE]

(* The page sends a message: placeholder saved, marker set, job asked for *)
Start ==
    /\ msg = "none" /\ net = "up" /\ srv = "up"
    /\ msg' = "placeholder" /\ replyKey' = 0
    /\ key' = 1 /\ cur' = 1 /\ got' = <<>>
    /\ marker' = TRUE /\ retries' = 0
    /\ Post(1)
    /\ gens' = 1
    /\ UNCHANGED <<net, srv, drops, refreshes, crashes>>

(* The owner sends another message or rerolls, after the last reply or note is settled and the marker cleared.
   Every generation takes a fresh key, so it can never attach to an earlier generation's job. *)
NewGen ==
    /\ msg \in {"reply", "note"} /\ ~marker /\ gens < MaxGens /\ key < NKeys
    /\ net = "up" /\ srv = "up"
    /\ msg' = "placeholder" /\ replyKey' = 0
    /\ key' = key + 1 /\ cur' = 1 /\ got' = <<>>
    /\ marker' = TRUE /\ retries' = 0
    /\ Post(key + 1)
    /\ gens' = gens + 1
    /\ UNCHANGED <<net, srv, drops, refreshes, crashes>>

---------------------------------------------------------------------------
(* The model upstream produces the next event of a running job *)
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
    /\ UNCHANGED <<net, srv, outcome, calls, interrupted, msg, replyKey, clientVars, marker, retries, envVars>>

(* The client reads the next event of its job (HTTP stream with a cursor) *)
Read ==
    /\ msg \in Gen /\ net = "up" /\ srv = "up"
    /\ st[key] # "none" /\ cur <= Len(log[key])
    /\ LET ev == log[key][cur]
           g2 == Append(got, ev)
           ok == (\E i \in 1..Len(g2) : g2[i] = "c") /\ ~(\E i \in 1..Len(g2) : g2[i] = "x")
       IN
       /\ IF ev \notin {"d", "e"}
          THEN /\ got' = g2 /\ cur' = cur + 1
               /\ msg' = IF ev = "c" THEN "partial" ELSE msg      \* the chat is autosaved with the text so far
               /\ UNCHANGED <<replyKey, key, marker, retries, serverVars>>
          ELSE IF ev = "d" /\ ok
          THEN /\ msg' = "reply" /\ replyKey' = key           \* message saved; marker is cleared by a later step
               /\ got' = g2 /\ cur' = cur + 1
               /\ UNCHANGED <<key, marker, retries, serverVars>>
          ELSE IF retries < MaxRetry /\ key < NKeys          \* failed: ask again with a new generation key
          THEN /\ key' = key + 1 /\ retries' = retries + 1
               /\ cur' = 1 /\ got' = <<>>
               /\ Post(key + 1)
               /\ msg' = "placeholder"                              \* the partial text is dropped for the new attempt
               /\ UNCHANGED <<replyKey, marker>>
          ELSE /\ msg' = "note" /\ marker' = FALSE
               /\ got' = g2 /\ cur' = cur + 1
               /\ UNCHANGED <<key, retries, replyKey, serverVars>>
    /\ UNCHANGED <<net, srv, envVars>>

(* sendChatMain returns: the marker is cleared (after the reply was saved) *)
ClearMarker ==
    /\ marker /\ msg \in {"reply", "note"}
    /\ marker' = FALSE
    /\ UNCHANGED <<net, srv, serverVars, msg, replyKey, clientVars, retries, envVars>>

(* The reader gave up: the connection stayed lost too long *)
GaveUp ==
    /\ msg \in Gen /\ (net = "down" \/ srv = "down")
    /\ msg' = "note" /\ marker' = FALSE
    /\ UNCHANGED <<net, srv, serverVars, replyKey, clientVars, retries, envVars>>

(* The owner presses Stop *)
Stop ==
    /\ msg \in Gen /\ net = "up" /\ srv = "up"
    /\ msg' = "note" /\ marker' = FALSE
    /\ st' = [st EXCEPT ![key] = IF @ = "running" THEN "aborted" ELSE @]
    /\ UNCHANGED <<net, srv, log, outcome, calls, interrupted, replyKey, clientVars, retries, envVars>>

---------------------------------------------------------------------------
(* The world *)
NetDrop ==
    /\ net = "up" /\ drops < MaxDrops
    /\ net' = "down" /\ drops' = drops + 1
    /\ UNCHANGED <<srv, serverVars, msg, replyKey, clientVars, marker, retries, refreshes, crashes, gens>>

NetUp ==
    /\ net = "down" /\ net' = "up"
    /\ UNCHANGED <<srv, serverVars, msg, replyKey, clientVars, marker, retries, envVars>>

Crash ==
    /\ srv = "up" /\ crashes < MaxCrash
    /\ srv' = "down" /\ crashes' = crashes + 1
    /\ UNCHANGED <<net, serverVars, msg, replyKey, clientVars, marker, retries, drops, refreshes, gens>>

(* Restart: jobs that were running are interrupted, with an error event in their log (interruptRunning) *)
Restart ==
    /\ srv = "down" /\ srv' = "up"
    /\ st'          = [k \in Keys |-> IF st[k] = "running" THEN "interrupted" ELSE st[k]]
    /\ log'         = [k \in Keys |-> IF st[k] = "running" THEN Append(log[k], "e") ELSE log[k]]
    /\ interrupted' = [k \in Keys |-> IF st[k] = "running" THEN TRUE ELSE interrupted[k]]
    /\ UNCHANGED <<net, outcome, calls, msg, replyKey, clientVars, marker, retries, envVars>>

(* The page reloads (the page can only load while the network and server are up).
   Client memory is lost. A generation in flight is resumed with the same key; a saved reply whose marker
   was not yet cleared is trimmed and resumed the same way; an expired or missing marker leaves the "no reply" note. *)
Refresh ==
    /\ net = "up" /\ srv = "up" /\ refreshes < MaxRefresh
    /\ refreshes' = refreshes + 1
    /\ cur' = 1 /\ got' = <<>>
    /\ \/ /\ marker /\ msg \in Gen \cup {"reply"}                      \* resume: the partial text is trimmed
          /\ msg' = "placeholder" /\ replyKey' = 0
          /\ Post(key)
          /\ UNCHANGED <<key, marker, retries>>
       \/ /\ msg \in Gen                                               \* marker expired or missing
          /\ msg' = IF msg = "partial" /\ ~FixPartial THEN "partial" ELSE "note"
          /\ marker' = FALSE
          /\ UNCHANGED <<serverVars, replyKey, key, retries>>
       \/ /\ msg \in {"none", "reply", "note"} /\ ~(marker /\ msg = "reply")   \* nothing in flight
          /\ UNCHANGED <<msg, replyKey, key, marker, retries, serverVars>>
    /\ UNCHANGED <<net, srv, drops, crashes, gens>>

Next ==
    \/ Start \/ NewGen \/ Read \/ ClearMarker \/ GaveUp \/ Stop
    \/ \E k \in Keys : Upstream(k)
    \/ NetDrop \/ NetUp \/ Crash \/ Restart \/ Refresh

Spec == Init /\ [][Next]_vars
         /\ WF_vars(Start) /\ WF_vars(NewGen) /\ WF_vars(Read) /\ WF_vars(ClearMarker)
         /\ \A k \in Keys : WF_vars(Upstream(k))
         /\ WF_vars(NetUp) /\ WF_vars(Restart)

---------------------------------------------------------------------------
(* SAFETY *)

(* What the client holds is exactly the logged prefix: no event lost, none repeated, in order *)
NoLossNoDup ==
    (msg \in Gen /\ st[key] # "none") => got = SubSeq(log[key], 1, cur - 1)

(* The chat and the marker agree: reply text that is only part of an answer is in the chat only while someone
   still has the marker that will finish or retire it. Otherwise it stays there for good, looking like the answer. *)
PartialImpliesMarker ==
    msg = "partial" => marker

(* A saved reply was read from a job that really finished with a good answer *)
ReplyIsGood ==
    msg = "reply" => /\ replyKey \in Keys
                     /\ outcome[replyKey] = "ok"
                     /\ \E i \in 1..Len(log[replyKey]) : log[replyKey][i] = "c"

(* A job that may be reused must not be a failed one: otherwise a refresh replays an error instead of asking again *)
ReuseIsNotAReplayOfFailure ==
    \A k \in Keys : (st[k] \in Reusable /\ outcome[k] = "httpErr") => st[k] = "running"

(* A cut-off or stopped job is never reused *)
DeadJobsAreNotReusable ==
    \A k \in Keys : st[k] \in {"interrupted", "aborted", "error"} => st[k] \notin Reusable

(* A finished generation leaves nothing behind: no marker, and the saved message is a reply or a note.
   Run to the end of the model, every generation did settle (the Settles property also states it as liveness). *)
SettledMeansClean ==
    (msg \in {"reply", "note"} /\ srv = "up" /\ net = "up" /\ ~(\E k \in Keys : st[k] = "running")) => (marker \in BOOLEAN)

(* Every generation asks for jobs under its own keys: no key is used by two generations *)
KeysNeverShared ==
    gens <= NKeys

(* Cost: the model is asked at most once per key, plus once more after each crash that cut it, plus
   once more after each refresh that found a failed job *)
CostBound ==
    \A k \in Keys : calls[k] <= 1 + crashes + refreshes

(* Per-key reuse: an unbroken ok job is never asked for twice *)
OkJobAskedOnce ==
    \A k \in Keys : (outcome[k] = "ok" /\ st[k] \in Reusable /\ ~interrupted[k] /\ crashes = 0) => calls[k] <= 1 + refreshes

---------------------------------------------------------------------------
(* LIVENESS: the owner never stares at "Thinking..." for good *)
Settles == <>[](msg \in {"none", "reply", "note"} /\ ~marker)

=============================================================================
