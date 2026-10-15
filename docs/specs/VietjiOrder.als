-- When "đi" at the end makes the verb before it an order (src/ts/process/vietjiDict.ts ordered/composeSuggestions,
-- vietjiImperative.ts). Each input is the facts the code computes; the decisions are the code's own formulas.
-- Checked (Alloy 6, 2026-10-15) after the sweep (vietjiSweep.test.ts) found orders of non-verbs: không đi → 不吧,
-- có đi → あってください, sẽ đi → 겠으세요.

abstract sig Bool {} one sig T, F extends Bool {}
sig Typed {
    lastIsDi: one Bool,     -- the last Vietnamese word is đi (đi nào, đi mà)
    person: one Bool,       -- the word before it is a person (tôi đi = I go)
    verbVote: one Bool,     -- the lists voted it a verb (and it is not a function word: có, là, sẽ…)
    formOk: one Bool,       -- the language's own ending marks it as a verb (-다, an u-row kana, an infinitive; Chinese: any word)
    meantVerb: one Bool     -- what the learner meant: an action verb
}
-- the vote is built so: a function word is never voted, a person is never voted
fact { all t: Typed | t.person = T implies t.verbVote = F }
-- what the vote can and cannot see: it is right about a word that is not a verb in two lists (the measured 0 wrong orders)
fact { all t: Typed | t.verbVote = T implies t.meantVerb = T }

pred offers[t: Typed] { t.lastIsDi = T and t.person = F and t.verbVote = T and t.formOk = T }
pred offersOld[t: Typed] { t.lastIsDi = T and t.person = F and t.formOk = T }

assert NoOrderOfNonVerb { all t: Typed | offers[t] implies t.meantVerb = T }
assert NoOrderAfterPerson { all t: Typed | t.person = T implies not offers[t] }
assert OrderNeedsDi { all t: Typed | offers[t] implies t.lastIsDi = T }
assert NoOrderOfNonVerbOld { all t: Typed | offersOld[t] implies t.meantVerb = T }
check NoOrderOfNonVerb for 5
check NoOrderAfterPerson for 5
check OrderNeedsDi for 5
check NoOrderOfNonVerbOld for 5
-- the order is still offered for a voted verb: not vacuous
run OrderOffered { some t: Typed | offers[t] } for 3
