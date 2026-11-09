---- MODULE ConsequenceLand ----
EXTENDS Naturals, FiniteSets
CONSTANTS MaxAge, MinTurn
VARIABLES turn, dues, ending, bad
vars == <<turn, dues, ending, bad>>
Init == /\ turn = 0 /\ dues = {} /\ ending = FALSE /\ bad = FALSE
Choose == /\ ~ending /\ dues' = dues \cup {0} /\ UNCHANGED <<turn, ending, bad>>
Tick == /\ ~ending /\ turn' = turn + 1
        /\ dues' = {age + 1 : age \in dues} /\ UNCHANGED <<ending, bad>>
Land == /\ ~ending /\ \E age \in dues : age <= MaxAge
        /\ dues' \in {dues \ {age} : age \in dues /\ age <= MaxAge}
        /\ UNCHANGED <<turn, ending, bad>>
ForceLand == /\ ~ending /\ \E age \in dues : age > MaxAge
             /\ dues' \in {dues \ {age} : age \in dues /\ age > MaxAge}
             /\ bad' = TRUE /\ UNCHANGED <<turn, ending>>
EndOK == /\ turn >= MinTurn /\ dues = {} /\ ending' = TRUE /\ UNCHANGED <<turn, dues, bad>>
\* Deliberately permits premature ending so EndingOnlyWhenReady detects it.
EndEarly == /\ ending' = TRUE /\ UNCHANGED <<turn, dues, bad>>
Next == Choose \/ Tick \/ Land \/ ForceLand \/ EndOK \/ EndEarly
Spec == Init /\ [][Next]_vars
NoOverdueLeft == \A age \in dues : age <= MaxAge
EndingOnlyWhenReady == ending => (turn >= MinTurn /\ dues = {})
====
