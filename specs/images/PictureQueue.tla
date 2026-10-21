------------------------------ MODULE PictureQueue ------------------------------
(***************************************************************************)
(* Pictures in a chat, and the message turns that ask for them (owner,      *)
(* 2026-10-20: "generate hình trong risu nên để 1 pipeline riêng biệt xử    *)
(* lý không theo pipeline của generate message").                           *)
(*                                                                         *)
(* One chat, turns 1..NT in order (one active turn per chat). A turn makes  *)
(* a reply message with a fresh id, then its Lua output trigger asks for a  *)
(* picture of that message, then the turn is tidied and saved: the message  *)
(* is then on the server. A turn can fail and be tried again (the reply is  *)
(* undone, the next attempt makes a message with another id).               *)
(*                                                                         *)
(* Mode = "inline": the code before this change. generateImage(...):await() *)
(*   inside the output trigger (imagegen.lua:122, scriptings.ts generateImage *)
(*   -> scenePictureDraw.ts drawOnServer -> waitImageJob, 10 min), and the   *)
(*   page awaits the trigger (index.svelte.ts runTrigger 'output'). The turn *)
(*   sits in "waitpic" until the picture ended; the worker's 25 min run     *)
(*   timeout (turnWorker.cjs runTimeoutMs) turns a slow picture into a failed *)
(*   or retried turn.                                                       *)
(* Mode = "queue": the trigger only files the request (a durable row on the *)
(*   server, one per key = chat + message + slot) and the turn goes on. The  *)
(*   server draws it (a concurrency limit, retries with a backoff) and, when *)
(*   it is drawn, puts it in the message BY MESSAGE ID into the chat file the *)
(*   server holds. A page that has the chat open sees it at its next poll;  *)
(*   its own writes are merged per message (dbMerge mergeRemote).           *)
(*                                                                         *)
(* Knobs: PlaceBy "id" | "index" (the last message, what a naive decoupling   *)
(*   of setChat(-1, ...) does), Idem (one job per key), Merge (the page's    *)
(*   write of the chat is merged, not last-writer-wins), Durable (a server   *)
(*   restart resumes the jobs), Limit (jobs drawn at once).                  *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Mode, PlaceBy, Idem, Merge, Durable, NT, MaxTry, MaxAtt, MaxFail, MaxResend, Limit

Ids  == 1..(NT * (MaxTry + 1))
Jobs == Ids \X (1..(1 + MaxResend))     \* a job is <<message, k>>: the k-th row filed for that message
Turns == 1..NT
Final == {"placed", "failed", "orphan"}

VARIABLES
    turn,       \* turn[t]: "idle" | "gen" | "trig" | "waitpic" | "tidy" | "saved" | "failed"
    tries,      \* attempts started for a turn
    msgOf,      \* msgOf[t]: the id of the reply of the turn's current attempt (0: none)
    nextId,
    saved,      \* ids of the messages the server's chat holds
    serverText, \* serverText[m]: the pictures (by the message they were drawn for) in message m on the server
    pageText,   \* the same in the page's copy of the chat
    jst,        \* "none" | "queued" | "running" | "retrying" | "drawn" | "placed" | "failed" | "orphan" | "lost"
    jatt,
    fails, resend, restarts,
    byPicture   \* turns that were failed or retried because a picture made them wait too long

vars == <<turn, tries, msgOf, nextId, saved, serverText, pageText, jst, jatt, fails, resend, restarts, byPicture>>
jobV == <<jst, jatt>>

Init ==
    /\ turn = [t \in Turns |-> "idle"] /\ tries = [t \in Turns |-> 0] /\ msgOf = [t \in Turns |-> 0] /\ nextId = 1
    /\ saved = {} /\ serverText = [m \in Ids |-> {}] /\ pageText = [m \in Ids |-> {}]
    /\ jst = [j \in Jobs |-> "none"] /\ jatt = [j \in Jobs |-> 0]
    /\ fails = 0 /\ resend = 0 /\ restarts = 0 /\ byPicture = {}

Running == {j \in Jobs : jst[j] = "running"}
JobOf(m) == {j \in Jobs : j[1] = m /\ jst[j] # "none"}
Gone(m) == m \notin saved /\ \A t \in Turns : msgOf[t] # m

(* ---------------- the message turn ---------------- *)
TStart(t) == /\ turn[t] = "idle" /\ (IF t = 1 THEN TRUE ELSE turn[t - 1] \in {"saved", "failed"}) /\ nextId \in Ids
    /\ turn' = [turn EXCEPT ![t] = "gen"] /\ tries' = [tries EXCEPT ![t] = @ + 1]
    /\ msgOf' = [msgOf EXCEPT ![t] = nextId] /\ nextId' = nextId + 1
    /\ UNCHANGED <<saved, serverText, pageText, jobV, fails, resend, restarts, byPicture>>

\* the turn fails and is tried again from its input, or ends failed when it is out of attempts; the reply is undone
Undo(t, cause) == /\ msgOf' = [msgOf EXCEPT ![t] = 0]
    /\ turn' = [turn EXCEPT ![t] = IF tries[t] <= MaxTry THEN "idle" ELSE "failed"]
    /\ byPicture' = (IF cause = "picture" THEN byPicture \cup {t} ELSE byPicture)
    /\ UNCHANGED <<tries, nextId, saved, serverText, pageText, jobV, fails, resend, restarts>>

TGenFail(t) == turn[t] = "gen" /\ Undo(t, "model")
TGen(t) == /\ turn[t] = "gen" /\ turn' = [turn EXCEPT ![t] = "trig"]
    /\ UNCHANGED <<tries, msgOf, nextId, saved, serverText, pageText, jobV, fails, resend, restarts, byPicture>>

\* the output trigger asks for the picture of the reply (Request is below)
Ask(m) == IF Idem /\ JobOf(m) # {} THEN UNCHANGED jobV
          ELSE \E k \in 1..(1 + MaxResend) : /\ jst[<<m, k>>] = "none" /\ (\A l \in 1..(k - 1) : jst[<<m, l>>] # "none")
                                              /\ jst' = [jst EXCEPT ![<<m, k>>] = "queued"] /\ UNCHANGED jatt
TTrig(t) == /\ turn[t] = "trig" /\ Ask(msgOf[t])
    /\ turn' = [turn EXCEPT ![t] = IF Mode = "inline" THEN "waitpic" ELSE "tidy"]
    /\ UNCHANGED <<tries, msgOf, nextId, saved, serverText, pageText, fails, resend, restarts, byPicture>>

\* inline: the awaited picture came back (drawn, or failed for good); the trigger puts it into the page's copy and ends
TInlineEnd(t) == /\ Mode = "inline" /\ turn[t] = "waitpic"
    /\ \E j \in JobOf(msgOf[t]) : /\ jst[j] \in {"drawn", "failed"}
        /\ pageText' = (IF jst[j] = "drawn" THEN [pageText EXCEPT ![msgOf[t]] = @ \cup {msgOf[t]}] ELSE pageText)
        /\ jst' = [jst EXCEPT ![j] = IF jst[j] = "drawn" THEN "placed" ELSE "failed"]
    /\ turn' = [turn EXCEPT ![t] = "tidy"]
    /\ UNCHANGED <<tries, msgOf, nextId, saved, serverText, jatt, fails, resend, restarts, byPicture>>
\* inline: the worker's run timeout fires while the turn waits for the picture
TTimeout(t) == /\ Mode = "inline" /\ turn[t] = "waitpic" /\ Undo(t, "picture")

TTidyFail(t) == turn[t] = "tidy" /\ Undo(t, "save")
TSave(t) == /\ turn[t] = "tidy"
    /\ turn' = [turn EXCEPT ![t] = "saved"] /\ saved' = saved \cup {msgOf[t]}
    /\ serverText' = [serverText EXCEPT ![msgOf[t]] = pageText[msgOf[t]]]
    /\ UNCHANGED <<tries, msgOf, nextId, pageText, jobV, fails, resend, restarts, byPicture>>

(* ---------------- the picture queue (the server) ---------------- *)
\* the request is sent again (a reply that never came back, a double tap): with a key it finds the row
ReAsk(m) == /\ resend < MaxResend /\ JobOf(m) # {} /\ Ask(m) /\ resend' = resend + 1
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, pageText, fails, restarts, byPicture>>
Start(j) == /\ jst[j] = "queued" /\ Cardinality(Running) < Limit
    /\ jst' = [jst EXCEPT ![j] = "running"] /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, pageText, jatt, fails, resend, restarts, byPicture>>
Succeed(j) == /\ jst[j] = "running" /\ jst' = [jst EXCEPT ![j] = "drawn"]
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, pageText, jatt, fails, resend, restarts, byPicture>>
\* the router fails: another try after a backoff, or failed for good when out of attempts
Fail(j) == /\ jst[j] = "running" /\ fails < MaxFail /\ fails' = fails + 1
    /\ (IF jatt[j] + 1 < MaxAtt THEN jst' = [jst EXCEPT ![j] = "retrying"] /\ jatt' = [jatt EXCEPT ![j] = @ + 1]
        ELSE jst' = [jst EXCEPT ![j] = "failed"] /\ UNCHANGED jatt)
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, pageText, resend, restarts, byPicture>>
Retry(j) == /\ jst[j] = "retrying" /\ jst' = [jst EXCEPT ![j] = "queued"]
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, pageText, jatt, fails, resend, restarts, byPicture>>
\* the picture goes into the message on the server (queue mode); the message may not be saved yet (the page saves it after the
\* trigger), and may never be (its turn was undone): then the picture belongs to nothing
Target(j) == IF PlaceBy = "id" THEN j[1] ELSE IF saved = {} THEN 0 ELSE CHOOSE m \in saved : \A k \in saved : k <= m
Place(j) == /\ Mode = "queue" /\ jst[j] = "drawn"
    /\ (IF Target(j) \in saved
        THEN serverText' = [serverText EXCEPT ![Target(j)] = @ \cup {j[1]}] /\ jst' = [jst EXCEPT ![j] = "placed"]
        ELSE /\ Gone(j[1]) /\ jst' = [jst EXCEPT ![j] = "orphan"] /\ UNCHANGED serverText)
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, pageText, jatt, fails, resend, restarts, byPicture>>
Restart == /\ restarts < 1 /\ restarts' = restarts + 1
    /\ jst' = [j \in Jobs |-> IF jst[j] = "running" THEN (IF Durable THEN "queued" ELSE "lost") ELSE jst[j]]
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, pageText, jatt, fails, resend, byPicture>>

(* ---------------- the page ---------------- *)
\* the page polls the picture rows of its chat and puts a placed picture into its own copy
PageSees(m) == /\ m \in saved /\ pageText[m] # serverText[m] /\ pageText' = [pageText EXCEPT ![m] = serverText[m]]
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, serverText, jobV, fails, resend, restarts, byPicture>>
\* the page writes the chat file (autosave): merged per message, the server's change to a message the page did not touch stays;
\* else the last writer wins and the page's copy replaces the message
PageWrite(m) == /\ m \in saved /\ pageText[m] # serverText[m]
    /\ serverText' = [serverText EXCEPT ![m] = IF Merge THEN @ \cup pageText[m] ELSE pageText[m]]
    /\ UNCHANGED <<turn, tries, msgOf, nextId, saved, pageText, jobV, fails, resend, restarts, byPicture>>

Next == \/ \E t \in Turns : TStart(t) \/ TGenFail(t) \/ TGen(t) \/ TTrig(t) \/ TInlineEnd(t) \/ TTimeout(t) \/ TTidyFail(t) \/ TSave(t)
        \/ \E m \in Ids : ReAsk(m) \/ PageSees(m) \/ PageWrite(m)
        \/ \E j \in Jobs : Start(j) \/ Succeed(j) \/ Fail(j) \/ Retry(j) \/ Place(j)
        \/ Restart

\* Fairness: the turn pipeline and the server's queue are given steps; the page never is (it may stay away for as long as it likes).
\* The router fails at most MaxFail times in all, so a picture that keeps being tried is drawn in the end.
Fair == /\ \A t \in Turns : WF_vars(TGen(t)) /\ WF_vars(TTrig(t)) /\ WF_vars(TInlineEnd(t)) /\ WF_vars(TTidyFail(t) \/ TSave(t)) /\ WF_vars(TStart(t))
        /\ \A j \in Jobs : WF_vars(Start(j)) /\ WF_vars(Succeed(j)) /\ WF_vars(Retry(j)) /\ WF_vars(Place(j))
Spec == Init /\ [][Next]_vars /\ Fair

(* ---------------- what must hold ---------------- *)
\* a message turn never waits for a picture
TurnNeverWaitsOnPicture == \A t \in Turns : turn[t] # "waitpic"
\* a picture never fails or retries a message turn
NoTurnFailedByPicture == byPicture = {}
\* a picture is only ever in the message it was drawn for (never in the last message, never in a message that is not its own)
NoWrongPlacement == \A m \in Ids : serverText[m] \subseteq {m} /\ pageText[m] \subseteq {m}
\* one job per key
OneJobPerKey == \A m \in Ids : Cardinality(JobOf(m)) <= 1
\* the queue's own concurrency limit
RunningLimit == Cardinality(Running) <= Limit
\* a picture that is in a message on the server stays there
PictureStays == [][\A m \in Ids : serverText[m] \subseteq serverText'[m]]_vars
\* every requested picture ends: placed in its message, failed for good, or its message was undone (orphan)
EveryPictureEnds == \A j \in Jobs : (jst[j] # "none") ~> jst[j] \in Final
\* every turn ends
EveryTurnEnds == \A t \in Turns : turn[t] = "idle" ~> turn[t] \in {"saved", "failed"}
==================================================================================
