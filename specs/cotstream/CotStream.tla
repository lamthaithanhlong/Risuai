---- MODULE CotStream ----
\* One streamed reply: the model thinks, then writes the reply. The thought is shown in its own panel as it arrives; the chat shows only
\* the reply. This checks the display state machine, not the network.
\*   Split = TRUE : the chat parser sees the reply part only (splitCoT before risuChatParser/ParseMarkdown)
\*   Split = FALSE: the chat parser sees the whole message (thought included), as before the panel existed
EXTENDS Naturals

CONSTANTS NT, NR, Split

VARIABLES
    phase,      \* "think" | "reply" | "done" | "dead"
    msg,        \* the saved-in-memory message: thought tokens, whether the thought block is still open, reply tokens
    main,       \* reply tokens drawn in the chat
    panel,      \* thought tokens drawn in the panel
    parses,     \* how many times the chat parser has run
    stored      \* "none" | "final" | "noreply" | "partial"

vars == <<phase, msg, main, panel, parses, stored>>

Init == /\ phase = "think" /\ msg = [th |-> 0, open |-> TRUE, rp |-> 0]
        /\ main = 0 /\ panel = 0 /\ parses = 0 /\ stored = "none"

\* what the network does
Think == /\ phase = "think" /\ msg.th < NT
         /\ msg' = [msg EXCEPT !.th = @ + 1] /\ UNCHANGED <<phase, main, panel, parses, stored>>
Start == /\ phase = "think" /\ phase' = "reply"
         /\ msg' = [msg EXCEPT !.open = FALSE] /\ UNCHANGED <<main, panel, parses, stored>>
Reply == /\ phase = "reply" /\ msg.rp < NR
         /\ msg' = [msg EXCEPT !.rp = @ + 1] /\ UNCHANGED <<phase, main, panel, parses, stored>>
Finish == /\ phase = "reply" /\ msg.rp > 0 /\ phase' = "done" /\ stored' = "final"
          /\ UNCHANGED <<msg, main, panel, parses>>
\* the page dies (locked phone, closed tab) mid-stream; settle-on-load decides what is kept
Die == /\ phase \in {"think", "reply"} /\ phase' = "dead"
       /\ stored' = IF msg.rp = 0 THEN "noreply" ELSE "partial"
       /\ UNCHANGED <<msg, main, panel, parses>>

\* what the page does with the message: redraw the panel, redraw the chat
DrawPanel == /\ panel # msg.th /\ panel' = msg.th /\ UNCHANGED <<phase, msg, main, parses, stored>>
Changed == IF Split THEN main # msg.rp
           ELSE (main # msg.rp \/ panel # msg.th \/ msg.open # (phase = "think"))
DrawChat == /\ Changed
            /\ main' = msg.rp
            /\ parses' = parses + 1
            /\ UNCHANGED <<phase, msg, panel, stored>>

Next == Think \/ Start \/ Reply \/ Finish \/ Die \/ DrawPanel \/ DrawChat
Spec == Init /\ [][Next]_vars

\* ---- properties ----
\* the chat never shows a thought token, the panel never shows a reply token (by construction of the counters; here as bounds)
Bounded == main <= msg.rp /\ panel <= msg.th
\* while the model is only thinking, nothing is drawn in the chat
ThinkingChatEmpty == (phase = "think") => main = 0
\* the chat parser runs only when the reply grew: thought chunks cost it nothing (the performance property)
ParserWork == parses <= msg.rp
\* the thought block is closed before any reply token exists
ClosedBeforeReply == (msg.rp > 0) => ~msg.open
\* a finished reply is stored whole; a reply cut during thinking is "noreply", never "final"
StoredSound == /\ (stored = "final") => (phase = "done" /\ msg.rp > 0)
               /\ (stored = "noreply") => msg.rp = 0
               /\ (stored = "partial") => msg.rp > 0
\* both views only ever grow
Monotone == [][main' >= main /\ panel' >= panel]_vars
====
