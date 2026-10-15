---------------------------- MODULE VietjiDetail ----------------------------
\* The "Chi tiết" panel (src/lib/ChatScreens/VietjiBar.svelte) and its asker (vietjiDict.ts makeAsker): a press opens the
\* panel for the sentence before that reply and asks the model once per sentence; answers come back in any order, a bad
\* answer (JSON that does not parse) is possible. Checked with TLC, 2026-10-15:
\*   ShowsItsOwnSentence  the panel never shows the answer of another sentence (answers arrive late, out of order)
\*   OneRequestPerSentence  at most one request out per sentence (pressing again while it is out does not ask again)
\*   PressAlwaysTries     a press on a sentence with no good answer yet asks the model (or one is already out):
\*                        FIXED = FALSE is the code before the fix, where a bad answer was kept and every later press
\*                        showed "Chưa phân tích được" without asking. The "how to say it" asker had the same fault (a
\*                        failed request kept as []): both now keep only a good answer.
EXTENDS Naturals, FiniteSets
CONSTANTS Sentences, FIXED, MaxAsks
None == "none"
VARIABLES panel, shown, out, done, asks, gaveUp
vars == <<panel, shown, out, done, asks, gaveUp>>

Init == /\ panel = None /\ shown = "none" /\ out = {} /\ done = [s \in Sentences |-> None] /\ asks = 0 /\ gaveUp = FALSE

Press(s) ==
    /\ panel' = s
    /\ IF done[s] = "good" THEN /\ shown' = "data" /\ UNCHANGED <<out, asks, gaveUp>>
       ELSE IF done[s] = "bad" THEN                     \* only the old code keeps a bad answer
            /\ shown' = "error" /\ gaveUp' = TRUE /\ UNCHANGED <<out, asks>>
       ELSE IF s \in out THEN /\ shown' = "loading" /\ UNCHANGED <<out, asks, gaveUp>>
       ELSE /\ asks < MaxAsks
            /\ shown' = "loading" /\ out' = out \cup {s} /\ asks' = asks + 1 /\ UNCHANGED gaveUp
    /\ UNCHANGED done

Answer(s, r) ==
    /\ s \in out
    /\ out' = out \ {s}
    /\ done' = IF r = "good" \/ ~FIXED THEN [done EXCEPT ![s] = r] ELSE done     \* the fix: a bad answer is forgotten
    /\ shown' = IF panel = s THEN (IF r = "good" THEN "data" ELSE "error") ELSE shown
    /\ UNCHANGED <<panel, asks, gaveUp>>

Close == /\ panel' = None /\ shown' = "none" /\ UNCHANGED <<out, done, asks, gaveUp>>

Next == \/ \E s \in Sentences : Press(s)
        \/ \E s \in Sentences, r \in {"good", "bad"} : Answer(s, r)
        \/ Close

ShowsItsOwnSentence == shown = "data" => (panel # None /\ done[panel] = "good")
OneRequestPerSentence == \A s \in Sentences : s \in out => done[s] = None \/ done[s] = "bad"
PressAlwaysTries == ~gaveUp
LoadingHasARequest == shown = "loading" => panel \in out
=============================================================================
