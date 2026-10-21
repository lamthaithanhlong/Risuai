---------------------------- MODULE TurnQueue ----------------------------
(***************************************************************************)
(* Who owns a turn once the player presses send (owner, 2026-10-20: "input *)
(* xong gửi xuống queue dựng cờ lên rồi xử lý").                            *)
(*                                                                         *)
(* Two chats, two pages (the phone and the Mac), inputs 1..NIn; input i is *)
(* sent in chat Home(i). A turn: the user's message, the helpers and the   *)
(* prompt (assemble), the model's reply (a durable server stream job,     *)
(* keyed), the tidy and Lua triggers, the reply saved into the chat.       *)
(*                                                                         *)
(* Owner = "page": the code before this change                             *)
(*   (src/lib/ChatScreens/DefaultChatScreen.svelte sendMain/sendChatMain). *)
(*   The page appends the user's message to its own copy of the chat, then *)
(*   writes the resume note (localStorage), assembles, starts the stream   *)
(*   job, reads it, tidies, saves. Only the stream job lives on the server. *)
(*   A page can be frozen (iOS: app switched, screen locked) for as long as *)
(*   the player is away, or killed and opened again. The slot that keeps    *)
(*   one turn at a time is the page's own (generationKey.ts), so two pages  *)
(*   each have one. A model error ends the turn with an alert; a stream the *)
(*   model cut is read as a finished reply. The resume note names its chat  *)
(*   by index (chatPage), which New Chat shifts (NewChatShift).             *)
(* Owner = "server": the turn is a row on the server (turnQueue.cjs) made   *)
(*   by POST /api/turns with the input and its key; the server's turn       *)
(*   worker runs the same pipeline in a page that is never frozen. One      *)
(*   active turn per chat, the rest wait in order. A model error or a cut   *)
(*   stream (the job ended in error) is tried again MaxRetry times, from    *)
(*   the input on (what follows it is cut away). A worker that dies loses   *)
(*   its lease; the turn goes back to the queue with the same key (the      *)
(*   stream job is reused when it finished well). The chat is found by id.  *)
(*   The player's page never writes the chat during a turn.                 *)
(*                                                                         *)
(* Fairness is given to the server and the model only, never to a page:    *)
(* a page may stay frozen or closed, which is exactly the owner's case.    *)
(* tests/turns/repro.mjs measured the OLD violations on the code.           *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Owner, NIn, MaxFail, MaxRetry, MaxKill, MaxCrash, MaxCut, NewChatShift, CutOnFail, SaveAck

Pages  == {"phone", "mac"}
Inputs == 1..NIn
Chats  == {"A", "B"}
Home(i)  == IF i % 2 = 1 THEN "A" ELSE "B"
Other(i) == IF Home(i) = "A" THEN "B" ELSE "A"
Msg(k, i) == [k |-> k, i |-> i]

VARIABLES
    saved,      \* the chats on the server: chat -> sequence of Msg("u", i) / Msg("r", i)
    pressed,    \* the inputs the player sent
    alive, frozen,
    slot,       \* page: the input of the turn it runs (0 = none)          [page]
    phase,      \* page: "idle" | "pushed" | "assembling" | "generating" | "tidying"   [page]
    target,     \* page: the chat its turn writes into                     [page]
    local,      \* page: user messages appended but not yet autosaved       [page]
    note,       \* page localStorage: the resume note (0 = none)            [page]
    job,        \* job[i]: "none" | "running" | "done" | "failed" | "cut"
    fails, cuts,
    partial,    \* inputs whose reply in a chat is the words of a cut stream, kept as the answer
    turn,       \* turn[i]: "none" | "queued" | "assembling" | "generating" | "tidying" | "saved" | "failed"   [server]
    attempt,
    queue,
    lease,
    gaveUp,     \* the turn ended with an error the player sees
    unflushed,  \* [server] the reply the worker's page holds but has not written to the save yet (0 = none)
    kills, crashes

vars == <<saved, pressed, alive, frozen, slot, phase, target, local, note, job, fails, cuts, partial, turn, attempt, queue, lease, gaveUp, kills, crashes, unflushed>>
pageV   == <<slot, phase, target, local, note>>
serverV == <<turn, attempt, queue, lease, unflushed>>

Has(c, m) == \E j \in 1..Len(saved[c]) : saved[c][j] = m
Count(c, m) == Cardinality({j \in 1..Len(saved[c]) : saved[c][j] = m})
AppendOnce(s, m) == IF \E j \in 1..Len(s) : s[j] = m THEN s ELSE Append(s, m)
AddTo(c, m) == [saved EXCEPT ![c] = AppendOnce(@, m)]

Init ==
    /\ saved = [c \in Chats |-> <<>>] /\ pressed = {}
    /\ alive = [p \in Pages |-> TRUE] /\ frozen = [p \in Pages |-> FALSE]
    /\ slot = [p \in Pages |-> 0] /\ phase = [p \in Pages |-> "idle"] /\ target = [p \in Pages |-> "A"]
    /\ local = [p \in Pages |-> {}] /\ note = [p \in Pages |-> 0]
    /\ job = [i \in Inputs |-> "none"] /\ fails = 0 /\ cuts = 0 /\ partial = {}
    /\ turn = [i \in Inputs |-> "none"] /\ attempt = [i \in Inputs |-> 0] /\ queue = <<>> /\ lease = 0
    /\ gaveUp = [i \in Inputs |-> FALSE] /\ kills = 0 /\ crashes = 0 /\ unflushed = 0

Running(p) == alive[p] /\ ~frozen[p]

(* ---------------- the world ---------------- *)
Freeze(p) == alive[p] /\ ~frozen[p] /\ frozen' = [frozen EXCEPT ![p] = TRUE]
    /\ UNCHANGED <<saved, pressed, alive, job, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED pageV /\ UNCHANGED serverV
Thaw(p) == frozen[p] /\ frozen' = [frozen EXCEPT ![p] = FALSE]
    /\ UNCHANGED <<saved, pressed, alive, job, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED pageV /\ UNCHANGED serverV
(* killed: the page's memory is gone (its slot, its phase, what it had not autosaved); localStorage stays *)
Kill(p) == alive[p] /\ kills < MaxKill
    /\ alive' = [alive EXCEPT ![p] = FALSE] /\ frozen' = [frozen EXCEPT ![p] = FALSE]
    /\ slot' = [slot EXCEPT ![p] = 0] /\ phase' = [phase EXCEPT ![p] = "idle"] /\ local' = [local EXCEPT ![p] = {}]
    /\ kills' = kills + 1
    /\ UNCHANGED <<saved, pressed, target, note, job, fails, cuts, partial, gaveUp, crashes>> /\ UNCHANGED serverV
(* opened again. Owner = page: bootstrap.ts readPending -> the note's turn runs again in the chat at the note's index, its message put
   back if that chat lacks it (planResumeWithRestore); after a New Chat that index can be another chat *)
Reopen(p) == ~alive[p]
    /\ alive' = [alive EXCEPT ![p] = TRUE]
    /\ (IF Owner = "page" /\ note[p] # 0
        THEN \E c \in {Home(note[p])} \cup (IF NewChatShift THEN {Other(note[p])} ELSE {}) :
             /\ slot' = [slot EXCEPT ![p] = note[p]] /\ phase' = [phase EXCEPT ![p] = "assembling"] /\ target' = [target EXCEPT ![p] = c]
             /\ saved' = AddTo(c, Msg("u", note[p]))
        ELSE UNCHANGED <<slot, phase, target, saved>>)
    /\ UNCHANGED <<pressed, frozen, local, note, job, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED serverV

ModelDone(i) == job[i] = "running" /\ job' = [job EXCEPT ![i] = "done"]
    /\ UNCHANGED <<saved, pressed, alive, frozen, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED pageV /\ UNCHANGED serverV
ModelFail(i) == job[i] = "running" /\ fails < MaxFail /\ job' = [job EXCEPT ![i] = "failed"] /\ fails' = fails + 1
    /\ UNCHANGED <<saved, pressed, alive, frozen, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED pageV /\ UNCHANGED serverV
(* the model dies mid-stream: some words came, then the connection broke (the job ends in error) *)
ModelCut(i) == job[i] = "running" /\ cuts < MaxCut /\ job' = [job EXCEPT ![i] = "cut"] /\ cuts' = cuts + 1
    /\ UNCHANGED <<saved, pressed, alive, frozen, fails, partial, gaveUp, kills, crashes>> /\ UNCHANGED pageV /\ UNCHANGED serverV

(* ---------------- Owner = page ---------------- *)
PSend(p, i) == Owner = "page" /\ Running(p) /\ slot[p] = 0 /\ i \notin pressed /\ (i = 1 \/ (i - 1) \in pressed)
    /\ pressed' = pressed \cup {i} /\ slot' = [slot EXCEPT ![p] = i] /\ phase' = [phase EXCEPT ![p] = "pushed"]
    /\ target' = [target EXCEPT ![p] = Home(i)] /\ local' = [local EXCEPT ![p] = @ \cup {i}]
    /\ UNCHANGED <<saved, alive, frozen, note, job, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED serverV
PAutosave(p) == Owner = "page" /\ Running(p) /\ local[p] # {}
    /\ \E i \in local[p] : saved' = AddTo(Home(i), Msg("u", i)) /\ local' = [local EXCEPT ![p] = @ \ {i}]
    /\ UNCHANGED <<pressed, alive, frozen, slot, phase, target, note, job, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED serverV
PNote(p) == Owner = "page" /\ Running(p) /\ phase[p] = "pushed"
    /\ note' = [note EXCEPT ![p] = slot[p]] /\ phase' = [phase EXCEPT ![p] = "assembling"]
    /\ UNCHANGED <<saved, pressed, alive, frozen, slot, target, local, job, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED serverV
PAssemble(p) == Owner = "page" /\ Running(p) /\ phase[p] = "assembling"
    /\ phase' = [phase EXCEPT ![p] = "generating"]
    /\ job' = [job EXCEPT ![slot[p]] = IF @ \in {"running", "done"} THEN @ ELSE "running"]
    /\ UNCHANGED <<saved, pressed, alive, frozen, slot, target, local, note, fails, cuts, partial, gaveUp, kills, crashes>> /\ UNCHANGED serverV
(* a cut stream is read to its end like any other: the words that came are the reply *)
PRead(p) == Owner = "page" /\ Running(p) /\ phase[p] = "generating" /\ job[slot[p]] \in {"done", "failed", "cut"}
    /\ (IF job[slot[p]] \in {"done", "cut"}
        THEN /\ phase' = [phase EXCEPT ![p] = "tidying"] /\ UNCHANGED <<slot, note, gaveUp>>
        ELSE /\ phase' = [phase EXCEPT ![p] = "idle"] /\ slot' = [slot EXCEPT ![p] = 0] /\ note' = [note EXCEPT ![p] = 0]
             /\ gaveUp' = [gaveUp EXCEPT ![slot[p]] = TRUE])
    /\ UNCHANGED <<saved, pressed, alive, frozen, target, local, job, fails, cuts, partial, kills, crashes>> /\ UNCHANGED serverV
PSave(p) == Owner = "page" /\ Running(p) /\ phase[p] = "tidying"
    /\ saved' = [saved EXCEPT ![target[p]] = Append(AppendOnce(@, Msg("u", slot[p])), Msg("r", slot[p]))]
    /\ partial' = (IF job[slot[p]] = "cut" THEN partial \cup {slot[p]} ELSE partial)
    /\ local' = [local EXCEPT ![p] = @ \ {slot[p]}]
    /\ phase' = [phase EXCEPT ![p] = "idle"] /\ slot' = [slot EXCEPT ![p] = 0] /\ note' = [note EXCEPT ![p] = 0]
    /\ UNCHANGED <<pressed, alive, frozen, target, job, fails, cuts, gaveUp, kills, crashes>> /\ UNCHANGED serverV

(* ---------------- Owner = server ---------------- *)
Active(i) == turn[i] \in {"assembling", "generating", "tidying"}
SSend(p, i) == Owner = "server" /\ Running(p) /\ (i = 1 \/ (i - 1) \in pressed)
    /\ pressed' = pressed \cup {i}
    /\ (IF turn[i] = "none" THEN turn' = [turn EXCEPT ![i] = "queued"] /\ queue' = Append(queue, i) ELSE UNCHANGED <<turn, queue>>)
    /\ UNCHANGED <<saved, alive, frozen, job, fails, cuts, partial, attempt, lease, gaveUp, kills, crashes, unflushed>> /\ UNCHANGED pageV
(* one active turn per chat: the oldest waiting turn of its chat, when the chat has none active *)
Waiting(i) == \E j \in 1..Len(queue) : queue[j] = i
OldestOfChat(i) == \E j \in 1..Len(queue) : queue[j] = i /\ \A k \in 1..(j - 1) : Home(queue[k]) # Home(i)
ChatFree(i) == ~(\E j \in Inputs : Active(j) /\ Home(j) = Home(i))
WLease == Owner = "server" /\ lease = 0
    /\ \E i \in Inputs :
       /\ Waiting(i) /\ OldestOfChat(i) /\ ChatFree(i)
       /\ lease' = i /\ queue' = SelectSeq(queue, LAMBDA x : x # i) /\ turn' = [turn EXCEPT ![i] = "assembling"]
    /\ unflushed' = 0
    /\ UNCHANGED <<saved, pressed, alive, frozen, job, fails, cuts, partial, attempt, gaveUp, kills, crashes>> /\ UNCHANGED pageV
(* the worker finds the chat by id and types the input once (by its message id); what follows the input (a cut reply of an earlier
   run) is cut away first (turnCore.ts planSend) *)
InputAt(c, i) == CHOOSE j \in 0..Len(saved[c]) : (j = 0 /\ ~Has(c, Msg("u", i))) \/ (j > 0 /\ saved[c][j] = Msg("u", i))
WAssemble == Owner = "server" /\ lease # 0 /\ turn[lease] = "assembling"
    /\ saved' = [saved EXCEPT ![Home(lease)] = IF InputAt(Home(lease), lease) = 0 THEN Append(@, Msg("u", lease))
                                                ELSE SubSeq(@, 1, InputAt(Home(lease), lease))]
    /\ partial' = partial \ {lease}
    /\ turn' = [turn EXCEPT ![lease] = "generating"]
    /\ job' = [job EXCEPT ![lease] = IF @ \in {"running", "done"} THEN @ ELSE "running"]
    /\ attempt' = [attempt EXCEPT ![lease] = IF job[lease] \in {"running", "done"} THEN @ ELSE @ + 1]
    /\ UNCHANGED <<pressed, alive, frozen, fails, cuts, queue, lease, gaveUp, kills, crashes, unflushed>> /\ UNCHANGED pageV
(* the worker's page writes the cut words as the reply and flushes the save, before the worker sees the job ended in error *)
WWritePartial == Owner = "server" /\ lease # 0 /\ turn[lease] = "generating" /\ job[lease] = "cut" /\ ~Has(Home(lease), Msg("r", lease))
    /\ saved' = AddTo(Home(lease), Msg("r", lease)) /\ partial' = partial \cup {lease}
    /\ UNCHANGED <<pressed, alive, frozen, job, fails, cuts, gaveUp, kills, crashes>> /\ UNCHANGED pageV /\ UNCHANGED serverV
(* CutOnFail: a run that did not save cuts what follows its input before the turn is retried or failed (turnWorkerPage.ts). Without
   it (CutOnFail = FALSE) TLC found the turn failed for good with the cut words left in the chat as its answer (NoCutAnswer). *)
CutAfterInput(c, i) == IF InputAt(c, i) = 0 THEN saved[c] ELSE SubSeq(saved[c], 1, InputAt(c, i))
WRead == Owner = "server" /\ lease # 0 /\ turn[lease] = "generating" /\ job[lease] \in {"done", "failed", "cut"}
    /\ saved' = (IF job[lease] # "done" /\ CutOnFail THEN [saved EXCEPT ![Home(lease)] = CutAfterInput(Home(lease), lease)] ELSE saved)
    /\ partial' = (IF job[lease] # "done" /\ CutOnFail THEN partial \ {lease} ELSE partial)
    /\ (IF job[lease] = "done"
        THEN turn' = [turn EXCEPT ![lease] = "tidying"] /\ UNCHANGED <<lease, queue, gaveUp, job>>
        ELSE IF attempt[lease] <= MaxRetry
             THEN /\ turn' = [turn EXCEPT ![lease] = "queued"] /\ queue' = <<lease>> \o queue /\ lease' = 0
                  /\ job' = [job EXCEPT ![lease] = "none"] /\ UNCHANGED gaveUp
             ELSE /\ turn' = [turn EXCEPT ![lease] = "failed"] /\ gaveUp' = [gaveUp EXCEPT ![lease] = TRUE] /\ lease' = 0
                  /\ UNCHANGED <<queue, job>>)
    /\ UNCHANGED <<pressed, alive, frozen, fails, cuts, attempt, kills, crashes, unflushed>> /\ UNCHANGED pageV
(* SaveAck: "saved" only once the server sees the turn's messages in its save (turnWorkerPage.ts __risuTurnInSave). Without it
   (SaveAck = FALSE) the turn was reported saved when the page's flushSave gave up, its write still pending; the worker then loaded the
   page again for the next turn and the write was gone (measured: tests/turns/repro.mjs double, the first reply lost). *)
WSave == Owner = "server" /\ lease # 0 /\ turn[lease] = "tidying"
    /\ (IF SaveAck THEN saved' = AddTo(Home(lease), Msg("r", lease)) /\ unflushed' = 0
        ELSE UNCHANGED saved /\ unflushed' = lease)
    /\ turn' = [turn EXCEPT ![lease] = "saved"] /\ lease' = 0
    /\ UNCHANGED <<pressed, alive, frozen, job, fails, cuts, partial, attempt, queue, gaveUp, kills, crashes>> /\ UNCHANGED pageV
(* the pending write lands, unless the worker loads the page again first (the next lease) *)
WFlush == Owner = "server" /\ unflushed # 0 /\ lease = 0
    /\ saved' = AddTo(Home(unflushed), Msg("r", unflushed)) /\ unflushed' = 0
    /\ UNCHANGED <<pressed, alive, frozen, job, fails, cuts, partial, gaveUp, kills, crashes, turn, attempt, queue, lease>> /\ UNCHANGED pageV
WCrash == Owner = "server" /\ lease # 0 /\ crashes < MaxCrash
    /\ turn' = [turn EXCEPT ![lease] = "queued"] /\ queue' = <<lease>> \o queue /\ lease' = 0 /\ crashes' = crashes + 1
    /\ UNCHANGED <<saved, pressed, alive, frozen, job, fails, cuts, partial, attempt, gaveUp, kills, unflushed>> /\ UNCHANGED pageV

Next ==
    \/ \E p \in Pages : Freeze(p) \/ Thaw(p) \/ Kill(p) \/ Reopen(p)
    \/ \E p \in Pages, i \in Inputs : PSend(p, i) \/ SSend(p, i)
    \/ \E p \in Pages : PAutosave(p) \/ PNote(p) \/ PAssemble(p) \/ PRead(p) \/ PSave(p)
    \/ \E i \in Inputs : ModelDone(i) \/ ModelFail(i) \/ ModelCut(i)
    \/ WLease \/ WAssemble \/ WWritePartial \/ WRead \/ WSave \/ WFlush \/ WCrash

Spec == Init /\ [][Next]_vars /\ WF_vars(WLease) /\ WF_vars(WAssemble) /\ WF_vars(WRead) /\ WF_vars(WSave)
        /\ (\A i \in Inputs : WF_vars(ModelDone(i)))

(* ---------------- properties ---------------- *)
AnsweredIn(c, i) == Has(c, Msg("r", i))
NoDuplicate == \A c \in Chats, i \in Inputs : Count(c, Msg("u", i)) <= 1 /\ Count(c, Msg("r", i)) <= 1
ReplyAfterInput == \A c \in Chats, i \in Inputs : \A j \in 1..Len(saved[c]) :
    saved[c][j] = Msg("r", i) => \E k \in 1..(j - 1) : saved[c][k] = Msg("u", i)
(* a reply lands in the chat its input was sent in, never in another one *)
ReplyInOwnChat == \A i \in Inputs : ~AnsweredIn(Other(i), i)
OneTurnPerChat == \A c \in Chats :
    IF Owner = "page" THEN Cardinality({p \in Pages : slot[p] # 0 /\ phase[p] \in {"assembling", "generating", "tidying"} /\ target[p] = c}) <= 1
    ELSE Cardinality({i \in Inputs : Active(i) /\ Home(i) = c}) <= 1
NoOrphan == \A i \in Inputs : (Has(Home(i), Msg("u", i)) /\ ~AnsweredIn(Home(i), i)) =>
    \/ gaveUp[i]
    \/ (Owner = "page" /\ \E p \in Pages : slot[p] = i \/ note[p] = i)
    \/ (Owner = "server" /\ turn[i] \in {"queued", "assembling", "generating", "tidying"})
RetryBeforeGivingUp == \A i \in Inputs : gaveUp[i] => (Owner = "server" /\ attempt[i] > MaxRetry)
(* the words of a cut stream are in the chat as an answer only while the server is still on that turn (it cuts them on its next run) *)
NoCutAnswer == \A i \in Inputs : (i \in partial) => (Owner = "server" /\ turn[i] \in {"queued", "assembling", "generating"})
(* a turn reported saved has its reply in the chat on the server *)
SavedStays == \A i \in Inputs : (turn[i] = "saved" /\ unflushed # i) => AnsweredIn(Home(i), i)
EveryTurnEnds == \A i \in Inputs : (i \in pressed) ~> (AnsweredIn(Home(i), i) \/ gaveUp[i])

TypeOK == turn \in [Inputs -> {"none", "queued", "assembling", "generating", "tidying", "saved", "failed"}]
=============================================================================
