---- MODULE ProseGate ----
\* Every reply the story writes in Vietnamese must have been requested with the prose reminder.
\* The model mirrors the player's language (measured: English first messages, Vietnamese replies to "Có").
\* A short player message ("Có") may not be recognised as Vietnamese by the letter count.
EXTENDS Naturals
CONSTANTS NEWGATE, MaxTurn, ASSUME_MARKS
Langs == {"en", "vi"}
VARIABLES first, translator, lastReply, turn, bad, badLate, misses
vars == <<first, translator, lastReply, turn, bad, badLate, misses>>
Init == /\ first \in Langs /\ translator \in {"vi", "off"} /\ lastReply = "none" /\ turn = 0 /\ bad = FALSE /\ badLate = FALSE /\ misses = 0
\* what the page sees of the story so far: the last reply, else the first message
Seen == IF lastReply = "none" THEN first ELSE lastReply
OldGate(userVi) == Seen = "vi"
NewGate(userVi) == Seen = "vi" \/ userVi \/ translator = "vi"
Turn == /\ turn < MaxTurn
        /\ \E userLang \in Langs, marked \in BOOLEAN, detected \in BOOLEAN, reply \in Langs :
              \* NEWGATE reads a single tone mark ("Có") as Vietnamese; only Vietnamese typed without marks ("ok", "di") is missed
              /\ (userLang = "en" => ~detected /\ ~marked)
              /\ (ASSUME_MARKS => (userLang = "vi" => marked))
              /\ (NEWGATE => (detected = (userLang = "vi" /\ marked)))
              \* the model writes in the player's language, or keeps the story's
              /\ reply \in {userLang, Seen}
              \* the player who reads through the Vietnamese translator writes Vietnamese
              /\ (translator = "vi" => userLang = "vi")
              /\ LET gate == IF NEWGATE THEN NewGate(detected) ELSE OldGate(detected)
                 IN /\ bad' = (bad \/ (reply = "vi" /\ ~gate))
                    /\ badLate' = (badLate \/ (turn > 0 /\ reply = "vi" /\ ~gate))
                    /\ misses' = misses + (IF reply = "vi" /\ ~gate THEN 1 ELSE 0)
              /\ lastReply' = reply
        /\ turn' = turn + 1 /\ UNCHANGED <<first, translator>>
Next == Turn \/ (turn = MaxTurn /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars
EveryVietnameseReplyReminded == ~bad
\* without any assumption on how the player types: a miss can only be the opening reply
MissOnlyOnOpening == ~badLate
\* whatever the player types: at most one Vietnamese reply goes without the reminder (the next one sees a Vietnamese reply)
AtMostOneMiss == misses <= 1
====
