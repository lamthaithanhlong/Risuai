---------------------------- MODULE LearningGrading ----------------------------
\* Learning-mode grading in Risu (learning.ts rememberReply). Each learner line gets a reply; a reply may carry [[CHECK]];
\* without one, Risu grades only an exact known phrase. A reply can be rerolled (regenerated) for the same learner line, and
\* rememberReply runs again on the new reply. GUARD = TRUE models the fix that remembers which line was graded.
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS MaxLines, MaxRerolls, GUARD
VARIABLES line, tried, known, rerolls, grades, gradedFor, missedLast, reminded

vars == <<line, tried, known, rerolls, grades, gradedFor, missedLast, reminded>>

Init == /\ line = 0 /\ tried = FALSE /\ known = FALSE /\ rerolls = 0
        /\ grades = [l \in 1..MaxLines |-> 0] /\ gradedFor = 0 /\ missedLast = FALSE /\ reminded = FALSE

\* the learner sends a new line (tried the language or not; exactly a known phrase or not)
Send == /\ line < MaxLines
        /\ \E t \in BOOLEAN, k \in BOOLEAN :
              /\ tried' = t /\ known' = (t /\ k)
        /\ line' = line + 1 /\ rerolls' = 0
        \* the request built for this line carries the reminder iff the previous reply missed its check
        /\ reminded' = missedLast
        /\ UNCHANGED <<grades, gradedFor, missedLast>>

\* a reply arrives (first one, or a reroll) and rememberReply runs on it
Reply(hasCheck) ==
        /\ line > 0
        /\ LET missed == tried /\ ~hasCheck
               canGrade == tried /\ (hasCheck \/ known)
               allowed == IF GUARD THEN gradedFor # line ELSE TRUE
           IN /\ missedLast' = missed
              /\ IF canGrade /\ allowed
                    THEN /\ grades' = [grades EXCEPT ![line] = @ + 1] /\ gradedFor' = line
                    ELSE UNCHANGED <<grades, gradedFor>>
        /\ UNCHANGED <<line, tried, known, reminded>>

First(h) == /\ rerolls = 0 /\ Reply(h) /\ rerolls' = 1
Reroll(h) == /\ rerolls >= 1 /\ rerolls <= MaxRerolls /\ Reply(h) /\ rerolls' = rerolls + 1

Next == Send \/ \E h \in BOOLEAN : First(h) \/ Reroll(h)

\* each learner line is graded at most once, however often its reply is regenerated
GradedOnce == \A l \in 1..MaxLines : grades[l] <= 1
\* a line that was not a try at the language is never graded
NoGradeWithoutTry == (line > 0 /\ ~tried) => grades[line] = 0
Spec == Init /\ [][Next]_vars
=============================================================================
