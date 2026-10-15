-- "đừng" before a verb is "do not"; "đi" after a verb is the order (src/ts/process/vietjiDict.ts ordered()). The two meet in
-- "đừng đi" (do not go): there đi is the verb go. Checked (Alloy 6, 2026-10-15).
abstract sig Bool {} one sig T, F extends Bool {}
sig Typed {
    dung: one Bool,        -- a part is đừng (chớ, đừng có, không được)
    nextVerb: one Bool,    -- the part after it is a voted verb, not a person
    endsDi: one Bool,      -- the last part is đi
    beforeDiVerb: one Bool -- the part before that đi is a voted verb (in "đừng đi" it is đừng: not a verb)
}
fact { all t: Typed | t.dung = T and t.endsDi = T and t.nextVerb = T implies t.beforeDiVerb = F }   -- đừng đi: before đi is đừng

pred notChip[t: Typed] { t.dung = T and t.nextVerb = T }
pred orderChip[t: Typed] { not notChip[t] and t.endsDi = T and t.beforeDiVerb = T }
pred orderChipOld[t: Typed] { t.endsDi = T and t.beforeDiVerb = T }                 -- before đừng existed
pred notChipFirstOld[t: Typed] { t.dung = T and t.nextVerb = T and not orderChipOld[t] }

assert NeverBoth { all t: Typed | not (notChip[t] and orderChip[t]) }
assert DungWins { all t: Typed | (t.dung = T and t.nextVerb = T) implies notChip[t] }
assert DungDiIsDoNotGo { all t: Typed | (t.dung = T and t.nextVerb = T and t.endsDi = T) implies (notChip[t] and not orderChip[t]) }
check NeverBoth for 5
check DungWins for 5
check DungDiIsDoNotGo for 5
run BothReachable { some t, u: Typed | notChip[t] and orderChip[u] } for 3
