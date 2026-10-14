---- MODULE SettleRace ----
\* A second page loads the saved chat while the first page is still generating the reply.
\* Today: a saved chat with isStreaming = TRUE is taken to be a dead page and its last reply is replaced by the "no reply" note
\* (settleChatOnLoad), which the loading page then saves. With UseBeat the generating page stamps `beat` every tick and a loader
\* only settles when the stamp is older than WINDOW ticks.
EXTENDS Naturals

CONSTANTS UseBeat, WINDOW, MAXT

VARIABLES
    db,         \* [reply: {"none","final","noreply"}, streaming: BOOLEAN, beat: 0..MAXT]
    gen,        \* "run" | "done" | "dead"
    ld,         \* "idle" | "loaded" | "saved"
    copy,       \* what the loader holds after loading
    now

vars == <<db, gen, ld, copy, now>>

Init == /\ db = [reply |-> "none", streaming |-> TRUE, beat |-> 0]
        /\ gen = "run" /\ ld = "idle" /\ copy = db /\ now = 0

\* the generating page: heartbeat, finish (writes the whole reply), or die (locked phone, closed tab)
Beat   == /\ gen = "run" /\ now < MAXT /\ now' = now + 1
          /\ db' = [db EXCEPT !.beat = IF UseBeat THEN now + 1 ELSE @]
          /\ UNCHANGED <<gen, ld, copy>>
Finish == /\ gen = "run" /\ gen' = "done"
          /\ db' = [reply |-> "final", streaming |-> FALSE, beat |-> now]
          /\ UNCHANGED <<ld, copy, now>>
Die    == /\ gen = "run" /\ gen' = "dead" /\ UNCHANGED <<db, ld, copy, now>>
Tick   == /\ gen # "run" /\ now < MAXT /\ now' = now + 1 /\ UNCHANGED <<db, gen, ld, copy>>

\* the loading page reads the saved chat and applies the settle rule
Stale == now - db.beat >= WINDOW
Alive == UseBeat /\ ~Stale
Load == /\ ld = "idle" /\ ld' = "loaded"
        /\ copy' = IF db.streaming /\ ~Alive
                      THEN [reply |-> "noreply", streaming |-> FALSE, beat |-> db.beat]
                      ELSE db
        /\ UNCHANGED <<db, gen, now>>
\* a chat that is still streaming is not saved (shouldTrackChatContent); anything else the loader saved is written back
Save == /\ ld = "loaded" /\ ld' = "saved"
        /\ IF copy.streaming THEN UNCHANGED db ELSE db' = copy
        /\ UNCHANGED <<gen, copy, now>>

Next == Beat \/ Finish \/ Die \/ Tick \/ Load \/ Save
Spec == Init /\ [][Next]_vars

\* the property the owner needs: a page that is still generating never sees its reply replaced by the note
LiveReplyNeverReplaced == (gen = "run") => db.reply # "noreply"
\* and a dead page does get settled, otherwise a killed phone would leave "Thinking..." forever (checked as reachability)
DeadNeverSettled == ~(gen = "dead" /\ db.reply = "noreply")
====
