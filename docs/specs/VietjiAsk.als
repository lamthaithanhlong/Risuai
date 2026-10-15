-- When the learning bar asks the model, and which chip wins when two say the same thing
-- (src/ts/process/vietjiDict.ts needsModel / dictSuggestions, src/ts/process/vietjiSuggest.ts suggestionPool).
--
-- Typed Vietnamese is cut into the longest known words; a syllable that starts no known word is skipped.
-- Measured 2026-10-15 (Alloy 6, scope 6):
--   SkippedWordAsks  (old needsModel: unsure or nothing found)   counterexample: "tôi xyz đói", both words sure, "xyz"
--                    skipped: the word-by-word chip drops a word and the model is not asked
--   SkippedWordAsks  (fixed: also when a syllable is skipped)    holds
--   ModelWins        (old pool order: list, then model)          counterexample: the model's "Oui" hidden by the list's "oui"
--   ModelWins        (fixed order: model, then list)             holds

open util/ordering[Pos]

sig Syl {}
sig Pos { syl: one Syl }
sig Word {}
sig Seg { at: set Pos, word: one Word }        -- a cut: the positions it covers, the list word it is

one sig List { known: set Word, unsure: set Word }

fact cuts {
    all s: Seg | some s.at and s.word in List.known
    all s: Seg | all p: s.at | p != last implies (p.next in s.at or p = max[s.at])   -- contiguous
    all s: Seg | all p, q: s.at | all r: Pos | (lt[p, r] and lt[r, q]) implies r in s.at
    all disj s, t: Seg | no s.at & t.at                                            -- no overlap
    List.unsure in List.known
}

fun skipped: set Pos { Pos - Seg.at }

pred needsModelOld { no Seg or some Seg.word & List.unsure }
pred needsModelFixed { no Seg or some Seg.word & List.unsure or some skipped }

-- never stay quiet while a typed word got no meaning
assert SkippedWordAsksOld   { (not needsModelOld)   implies no skipped }
assert SkippedWordAsksFixed { (not needsModelFixed) implies no skipped }
check SkippedWordAsksOld for 6
check SkippedWordAsksFixed for 6

-- the pool keeps the first chip of each text: the model's answer must win over a guess from the list
abstract sig Source {}
one sig Asked, Dict, Notebook extends Source {}
sig Chip { text: one Syl, src: one Source }
pred ahead[a, b: Source, fixed: Bool] {
    fixed = True  implies (a = Asked and b != Asked) or (a = Dict and b = Notebook)
    fixed = False implies (a = Dict and b != Dict) or (a = Asked and b = Notebook)
}
abstract sig Bool {} one sig True, False extends Bool {}
fun kept[fixed: Bool]: set Chip {
    { c: Chip | no d: Chip - c | d.text = c.text and ahead[d.src, c.src, fixed] }
}
assert ModelWinsOld   { all c: Chip | c.src = Asked implies c in kept[False] }
assert ModelWinsFixed { all c: Chip | c.src = Asked implies c in kept[True] }
check ModelWinsOld for 4
check ModelWinsFixed for 4
