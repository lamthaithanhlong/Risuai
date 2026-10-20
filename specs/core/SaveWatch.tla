---------------------------- MODULE SaveWatch ----------------------------
(* The autosave's change effects (src/ts/storage/saveWatch.svelte.ts) and the save loop (globalApi.svelte.ts saveDb) on top of the
   load (bootstrap.ts loadData). The page's database has four parts: the root settings, the selected character's card (lorebook,
   scripts), its open chat and another of its chats (a reply can land there after the player switched, chatSlot.ts).
   A Svelte effect re-runs when a value it read in its last run changes; each run notes a change (saveTracker.noteChange) and arms
   the 500 ms debounce, whose firing marks the save signal. The loop takes the signal, records the change number, encodes the
   character block (card + chats) and then the root block (two steps: encodeBlock awaits, edits can come in between), writes, and
   marks that change number saved. While the open chat streams, its content is not read, only the isStreaming flag.
   Watch = "split"   : the fix. Three effects: root, card (the character without chats), chats (all of them).
   Watch = "one"     : before the fix. One effect read ($state.snapshot) root, card and chats.
   Watch = "openonly": a split that walks only the open chat (the tempting cheaper one).
   EarlySave = TRUE  : saveDb starts before the load has put the server's save into the page.
   Edits are bounded (MaxEdits in all) so that the system comes to rest. *)
EXTENDS Naturals, FiniteSets
CONSTANTS Watch, EarlySave, MaxEdits, MaxStreams

Parts == {"root", "card", "open", "other"}
Effects == IF Watch = "one" THEN {"all"} ELSE {"root", "char", "chats"}
Chats == IF Watch = "openonly" THEN {"open"} ELSE {"open", "other"}

VARIABLES phase,      \* "loading" | "loaded"
          db,         \* the page's database: part -> version (0 = not loaded)
          server,     \* database.bin on the server: part -> version
          streaming,  \* the open chat streams a reply
          started,    \* saveDb has created the effects
          pending,    \* effects that have not run yet since they were created
          deps,       \* effect -> the parts it read in its last run
          seen,       \* effect -> the versions it read in its last run
          seenFlag,   \* effect -> the isStreaming it read (chats and the single effect read it)
          changed, saved, armed, signal,
          loop, seqAtStart, snap,
          edits, streams

vars == <<phase, db, server, streaming, started, pending, deps, seen, seenFlag, changed, saved, armed, signal, loop, seqAtStart, snap, edits, streams>>

ReadsFlag(e) == e \in {"chats", "all"}
\* what an effect reads when it runs now
Reads(e) == CASE e = "root"  -> {"root"}
              [] e = "char"  -> {"card"}
              [] e = "chats" -> IF streaming THEN {} ELSE Chats
              [] e = "all"   -> {"root", "card"} \cup (IF streaming THEN {} ELSE Chats)
Dirty(e) == \/ e \in pending
            \/ \E p \in deps[e] : seen[e][p] # db[p]
            \/ ReadsFlag(e) /\ seenFlag[e] # streaming

Zero == [p \in Parts |-> 0]
Init == /\ phase = "loading" /\ db = Zero /\ server = [p \in Parts |-> 1] /\ streaming = FALSE
        /\ started = FALSE /\ pending = {} /\ deps = [e \in Effects |-> {}] /\ seen = [e \in Effects |-> Zero]
        /\ seenFlag = [e \in Effects |-> FALSE]
        /\ changed = 0 /\ saved = 0 /\ armed = FALSE /\ signal = FALSE
        /\ loop = "idle" /\ seqAtStart = 0 /\ snap = Zero /\ edits = 0 /\ streams = 0

Effectless == UNCHANGED <<started, pending, deps, seen, seenFlag, changed, saved, armed, signal, loop, seqAtStart, snap>>

\* setDatabase(decodeRisuSave(...)): the whole save at once
Load == /\ phase = "loading" /\ db' = server /\ phase' = "loaded"
        /\ UNCHANGED <<server, streaming, edits, streams>> /\ Effectless

StartSave == /\ ~started /\ (phase = "loaded" \/ EarlySave)
             /\ started' = TRUE /\ pending' = Effects
             /\ UNCHANGED <<phase, db, server, streaming, deps, seen, seenFlag, changed, saved, armed, signal, loop, seqAtStart, snap, edits, streams>>

Edit(p) == /\ phase = "loaded" /\ edits < MaxEdits
           /\ db' = [db EXCEPT ![p] = @ + 1] /\ edits' = edits + 1
           /\ UNCHANGED <<phase, server, streaming, streams>> /\ Effectless

StreamStart == /\ phase = "loaded" /\ ~streaming /\ streams < MaxStreams /\ streaming' = TRUE /\ streams' = streams + 1
               /\ UNCHANGED <<phase, db, server, edits>> /\ Effectless
StreamEnd == /\ streaming /\ streaming' = FALSE /\ UNCHANGED <<phase, db, server, edits, streams>> /\ Effectless

RunEffect(e) == /\ started /\ Dirty(e)
                /\ deps' = [deps EXCEPT ![e] = Reads(e)] /\ seen' = [seen EXCEPT ![e] = db]
                /\ seenFlag' = [seenFlag EXCEPT ![e] = streaming] /\ pending' = pending \ {e}
                /\ changed' = changed + 1 /\ armed' = TRUE
                /\ UNCHANGED <<phase, db, server, streaming, started, saved, signal, loop, seqAtStart, snap, edits, streams>>

Fire == /\ armed /\ armed' = FALSE /\ signal' = TRUE
        /\ UNCHANGED <<phase, db, server, streaming, started, pending, deps, seen, seenFlag, changed, saved, loop, seqAtStart, snap, edits, streams>>

Take == /\ started /\ loop = "idle" /\ signal /\ signal' = FALSE /\ seqAtStart' = changed /\ loop' = "char"
        /\ UNCHANGED <<phase, db, server, streaming, started, pending, deps, seen, seenFlag, changed, saved, armed, snap, edits, streams>>
EncChar == /\ loop = "char" /\ snap' = [snap EXCEPT !["card"] = db["card"], !["open"] = db["open"], !["other"] = db["other"]]
           /\ loop' = "root"
           /\ UNCHANGED <<phase, db, server, streaming, started, pending, deps, seen, seenFlag, changed, saved, armed, signal, seqAtStart, edits, streams>>
EncRoot == /\ loop = "root" /\ snap' = [snap EXCEPT !["root"] = db["root"]] /\ loop' = "write"
           /\ UNCHANGED <<phase, db, server, streaming, started, pending, deps, seen, seenFlag, changed, saved, armed, signal, seqAtStart, edits, streams>>
Write == /\ loop = "write" /\ server' = snap /\ saved' = (IF seqAtStart > saved THEN seqAtStart ELSE saved) /\ loop' = "idle"
         /\ UNCHANGED <<phase, db, streaming, started, pending, deps, seen, seenFlag, changed, armed, signal, seqAtStart, snap, edits, streams>>

Next == \/ Load \/ StartSave \/ StreamStart \/ StreamEnd \/ Fire \/ Take \/ EncChar \/ EncRoot \/ Write
        \/ \E p \in Parts : Edit(p)
        \/ \E e \in Effects : RunEffect(e)

Spec == Init /\ [][Next]_vars /\ WF_vars(Load) /\ WF_vars(StartSave) /\ WF_vars(StreamEnd) /\ WF_vars(Fire) /\ WF_vars(Take)
        /\ WF_vars(EncChar) /\ WF_vars(EncRoot) /\ WF_vars(Write) /\ \A e \in Effects : WF_vars(RunEffect(e))

TypeOK == loop \in {"idle", "char", "root", "write"} /\ saved <= changed

AtRest == started /\ (\A e \in Effects : ~Dirty(e)) /\ ~armed /\ ~signal /\ loop = "idle" /\ ~streaming
\* nothing left to run and the page holds what the server holds: no change was lost
NoLostChange == AtRest => server = db
\* saveTracker.flush: "everything noted is saved" (and no effect still has to note something) means the server has it
FlushSound == (started /\ saved = changed /\ loop = "idle" /\ ~streaming /\ \A e \in Effects : ~Dirty(e)) => server = db
\* a partial (or not yet made) load is never written over the full save
ServerKeepsLoad == \A p \in Parts : server[p] >= 1
\* writes reach the server in order: no part goes back to an older version
NoRegress == [][\A p \in Parts : server'[p] >= server[p]]_vars
\* the cost the fix is for: an effect that reads the card is never re-run by anything but the card
NoCardWalkOnChat == \A e \in Effects : ("card" \in deps[e] /\ Dirty(e) /\ e \notin pending) => seen[e]["card"] # db["card"]
\* and the save always catches up
EventuallySaved == <>[](server = db)
=============================================================================
