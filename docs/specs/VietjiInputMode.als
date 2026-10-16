-- What the learning bar does with what is typed (src/lib/ChatScreens/VietjiBar.svelte, vietjiSuggest.ts, vietjiIme.ts).
-- Each input is described by the facts the code computes; the decisions below are the code's own boolean formulas.
-- Checked (Alloy 6, 2026-10-15), each a bug the learner reported:
--   OfferedSoundNeverAsks   "ùa lái tảng mẩn" / "ủa" (the sound of an offered answer) was looked up as Vietnamese and sent to the model
--   OfferedAnswerFirst      "ủa" showed no answer, only single characters
--   VietnameseNotEaten      a common Vietnamese word ("là") would be rewritten as 辣 at the space
--   VietnameseWordsFirst    "… 침착하다 đi": đi read exactly as 디, so 디 came first and the meaning chips after (2026-10-15)
--   EnglishTypedStays       English: the box holds Vietnamese, Việt-ji and English at once; English typed as it is (plain
--                           letters, no hyphen) is never taken for sound nor rewritten at the space (2026-10-15)

sig Input {
    marks: one Bool,          -- has Vietnamese tone or hat marks (looksVietnamese)
    offeredSound: one Bool,   -- folded, it starts an offered answer's sound: 3+ letters or its whole first syllable (soundMatch)
    exactSound: one Bool,     -- reads as words with every tone as typed (isSoundTyping)
    vietWord: one Bool,       -- the last word is a Vietnamese dictionary word
    hyphen: one Bool,         -- the last word joins syllables with "-"
    endsSpace: one Bool,
    listSure: one Bool,       -- the offline list answers it without guessing
    allViet: one Bool,        -- every word of the sound at the end is a Vietnamese dictionary word
    english: one Bool,        -- the language being learned is English (its sound typing is Latin letters too)
    plain: one Bool           -- the last word is plain letters: no hyphen, no Vietnamese letter or mark (looksLikeVietji false)
}
fact { all i: Input | i.hyphen = T implies i.plain = F }
fact { all i: Input | i.allViet = T implies i.vietWord = T }
abstract sig Bool {} one sig T, F extends Bool {}

-- isSoundTyping: clearly sound only when it reads exactly and is not all Vietnamese words (a hyphen is always sound)
pred soundTyping[i: Input] { i.exactSound = T and (i.hyphen = T or i.allViet = F) and (i.english = F or i.plain = F) }
-- typedViet: Vietnamese to look up by meaning (and maybe to ask the model about)
pred typedViet[i: Input] { i.marks = T and i.offeredSound = F and not soundTyping[i] }
-- mixChips: the sound chips first when it is sound; left out when the list knows the Vietnamese
pred soundFirst[i: Input] { soundTyping[i] }
pred soundShown[i: Input] { soundTyping[i] or i.listSure = F or not typedViet[i] }
pred asksModel[i: Input] { typedViet[i] and i.listSure = F }
-- the order: offered answers first when the input is clearly sound
pred offeredFirst[i: Input] { i.offeredSound = T and soundTyping[i] }
-- commitOnSpace
pred commits[i: Input] { i.endsSpace = T and i.exactSound = T and (i.hyphen = T or i.vietWord = F) and (i.english = F or i.plain = F) }

assert OfferedSoundNeverAsks { all i: Input | i.offeredSound = T implies not asksModel[i] }
assert OfferedAnswerFirst { all i: Input | (i.offeredSound = T and soundTyping[i]) implies offeredFirst[i] }
assert VietnameseWordsFirst { all i: Input | (i.marks = T and i.allViet = T and i.hyphen = F and i.offeredSound = F and i.listSure = T)
    implies (typedViet[i] and not soundFirst[i] and not soundShown[i]) }
assert HyphenStaysSound { all i: Input | (i.exactSound = T and i.hyphen = T) implies soundFirst[i] }
assert VietnameseNotEaten { all i: Input | (i.vietWord = T and i.hyphen = F) implies not commits[i] }
check OfferedSoundNeverAsks for 4
check OfferedAnswerFirst for 4
check VietnameseNotEaten for 4
check VietnameseWordsFirst for 4
assert EnglishTypedStays { all i: Input | (i.english = T and i.plain = T) implies (not soundTyping[i] and not commits[i]) }
assert EnglishVietjiWrites { all i: Input | (i.english = T and i.hyphen = T and i.exactSound = T and i.endsSpace = T) implies commits[i] }
check EnglishTypedStays for 4
check EnglishVietjiWrites for 4
pred commitsNoGuard[i: Input] { i.endsSpace = T and i.exactSound = T and (i.hyphen = T or i.vietWord = F) }
assert EnglishTypedStaysNoGuard { all i: Input | (i.english = T and i.plain = T) implies not commitsNoGuard[i] }
check EnglishTypedStaysNoGuard for 4
check HyphenStaysSound for 4

-- the version before the fixes, to see each property fail on it
pred typedVietOld[i: Input] { i.marks = T }
pred commitsOld[i: Input] { i.endsSpace = T and i.exactSound = T }
assert OfferedSoundNeverAsksOld { all i: Input | i.offeredSound = T implies not (typedVietOld[i] and i.listSure = F) }
assert VietnameseNotEatenOld { all i: Input | (i.vietWord = T and i.hyphen = F) implies not commitsOld[i] }
check OfferedSoundNeverAsksOld for 4
check VietnameseNotEatenOld for 4
pred soundFirstOld[i: Input] { i.exactSound = T }
assert VietnameseWordsFirstOld { all i: Input | (i.marks = T and i.allViet = T and i.hyphen = F and i.offeredSound = F and i.listSure = T)
    implies not soundFirstOld[i] }
check VietnameseWordsFirstOld for 4
