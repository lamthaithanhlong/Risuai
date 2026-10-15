-- What the learning bar does with what is typed (src/lib/ChatScreens/VietjiBar.svelte, vietjiSuggest.ts, vietjiIme.ts).
-- Each input is described by the facts the code computes; the decisions below are the code's own boolean formulas.
-- Checked (Alloy 6, 2026-10-15), each a bug the learner reported:
--   OfferedSoundNeverAsks   "ùa lái tảng mẩn" / "ủa" (the sound of an offered answer) was looked up as Vietnamese and sent to the model
--   OfferedAnswerFirst      "ủa" showed no answer, only single characters
--   VietnameseNotEaten      a common Vietnamese word ("là") would be rewritten as 辣 at the space

sig Input {
    marks: one Bool,          -- has Vietnamese tone or hat marks (looksVietnamese)
    offeredSound: one Bool,   -- folded, it starts an offered answer's sound: 3+ letters or its whole first syllable (soundMatch)
    exactSound: one Bool,     -- reads as words with every tone as typed (isSoundTyping)
    vietWord: one Bool,       -- the last word is a Vietnamese dictionary word
    hyphen: one Bool,         -- the last word joins syllables with "-"
    endsSpace: one Bool,
    listSure: one Bool        -- the offline list answers it without guessing
}
abstract sig Bool {} one sig T, F extends Bool {}

-- typedViet: Vietnamese to look up by meaning (and maybe to ask the model about)
pred typedViet[i: Input] { i.marks = T and i.offeredSound = F and i.exactSound = F }
pred asksModel[i: Input] { typedViet[i] and i.listSure = F }
-- the order: offered answers first when the input is clearly sound
pred offeredFirst[i: Input] { i.offeredSound = T and i.exactSound = T }
-- commitOnSpace
pred commits[i: Input] { i.endsSpace = T and i.exactSound = T and (i.hyphen = T or i.vietWord = F) }

assert OfferedSoundNeverAsks { all i: Input | i.offeredSound = T implies not asksModel[i] }
assert OfferedAnswerFirst { all i: Input | (i.offeredSound = T and i.exactSound = T) implies offeredFirst[i] }
assert VietnameseNotEaten { all i: Input | (i.vietWord = T and i.hyphen = F) implies not commits[i] }
check OfferedSoundNeverAsks for 4
check OfferedAnswerFirst for 4
check VietnameseNotEaten for 4

-- the version before the fixes, to see each property fail on it
pred typedVietOld[i: Input] { i.marks = T }
pred commitsOld[i: Input] { i.endsSpace = T and i.exactSound = T }
assert OfferedSoundNeverAsksOld { all i: Input | i.offeredSound = T implies not (typedVietOld[i] and i.listSure = F) }
assert VietnameseNotEatenOld { all i: Input | (i.vietWord = T and i.hyphen = F) implies not commitsOld[i] }
check OfferedSoundNeverAsksOld for 4
check VietnameseNotEatenOld for 4
