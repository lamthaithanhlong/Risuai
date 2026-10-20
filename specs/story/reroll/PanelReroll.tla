---------------------------- MODULE PanelReroll ----------------------------
\* A reply writes the status panel (st: a counter it pays, as status.lua applies the narrator's [[STATUS]] block) and the
\* ledger (led: the timeline, [[LEDGER]] "event:" lines appended). A reroll pops the reply and asks again; a delete pops it.
\* The app keeps the panel before the latest reply with that reply's id and puts it back at the next request once the reply
\* is gone (gameMasterPage.ts settlePanel). Mode: "none" (before 21380949), "st" (21380949: st_* only, the latest reply only),
\* "both" (st_* and led_*, the latest reply only), "stack" (st_* and led_*, one snapshot per reply, the last Cap replies: a
\* rollback over several replies at once goes back to before the oldest one gone).
\* Safety: when a request leaves, the prompt shows what the replies in the chat paid, once each.
EXTENDS Naturals, Sequences
CONSTANTS Mode, MaxId, MaxLen, Cap
VARIABLES chat, st, led, snapAt, snapSt, snapLed, reqSt, reqLed, pending, next, snaps
vars == <<chat, st, led, snapAt, snapSt, snapLed, reqSt, reqLed, pending, next, snaps>>

In(id) == \E i \in 1..Len(chat) : chat[i] = id

Init == chat = <<>> /\ st = 0 /\ led = <<>> /\ snapAt = 0 /\ snapSt = 0 /\ snapLed = <<>>
        /\ reqSt = 0 /\ reqLed = <<>> /\ pending = FALSE /\ next = 1 /\ snaps = <<>>

\* sendChat starts: settle, then the prompt is built from the panel
Settle(c, s, l) ==
    IF snapAt # 0 /\ ~(\E i \in 1..Len(c) : c[i] = snapAt)
    THEN <<IF Mode \in {"st", "both"} THEN snapSt ELSE s, IF Mode = "both" THEN snapLed ELSE l, 0>>
    ELSE <<s, l, snapAt>>

\* stack: the oldest kept reply that is gone, with every kept reply after it gone too (a rollback of the chat's end)
Gone(c, k) == \A j \in k..Len(snaps) : ~(\E i \in 1..Len(c) : c[i] = snaps[j][1])
Cut(c) == IF \E k \in 1..Len(snaps) : Gone(c, k) THEN CHOOSE k \in 1..Len(snaps) : Gone(c, k) /\ (k = 1 \/ ~Gone(c, k - 1)) ELSE 0

Ask(c) == IF Mode = "stack"
    THEN LET k == Cut(c) IN
        /\ chat' = c /\ pending' = TRUE
        /\ st' = (IF k = 0 THEN st ELSE snaps[k][2]) /\ led' = (IF k = 0 THEN led ELSE snaps[k][3])
        /\ snaps' = (IF k = 0 THEN snaps ELSE SubSeq(snaps, 1, k - 1))
        /\ reqSt' = st' /\ reqLed' = led'
        /\ UNCHANGED <<snapAt, snapSt, snapLed, next>>
    ELSE LET r == Settle(c, st, led) IN
        /\ chat' = c /\ st' = r[1] /\ led' = r[2] /\ snapAt' = r[3]
        /\ reqSt' = r[1] /\ reqLed' = r[2] /\ pending' = TRUE
        /\ UNCHANGED <<snapSt, snapLed, next, snaps>>

Request == ~pending /\ Len(chat) < MaxLen /\ Ask(chat)
Reroll  == ~pending /\ Len(chat) > 0 /\ Ask(SubSeq(chat, 1, Len(chat) - 1))
Delete  == ~pending /\ Len(chat) > 0 /\ chat' = SubSeq(chat, 1, Len(chat) - 1)
           /\ UNCHANGED <<st, led, snapAt, snapSt, snapLed, reqSt, reqLed, pending, next, snaps>>

\* the reply pays one and logs itself (the card's script, then the helper); the app keeps the panel as the request left
Reply == pending /\ next <= MaxId
    /\ chat' = Append(chat, next) /\ st' = st + 1 /\ led' = Append(led, next)
    /\ snapAt' = next /\ snapSt' = reqSt /\ snapLed' = reqLed
    /\ pending' = FALSE /\ next' = next + 1 /\ UNCHANGED <<reqSt, reqLed>>
    /\ snaps' = LET s2 == Append(snaps, <<next, reqSt, reqLed>>) IN IF Len(s2) > Cap THEN SubSeq(s2, 2, Len(s2)) ELSE s2

Next == Request \/ Reroll \/ Delete \/ Reply \/ (next > MaxId /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars

PaidOnce   == pending => st = Len(chat)
LoggedOnce == pending => led = chat
=============================================================================
