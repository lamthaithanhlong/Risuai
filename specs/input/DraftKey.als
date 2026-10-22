-- Which chat an unsent draft belongs to (chatDraft.ts draftKey, characters.ts "risuAllChats" import), 2026-10-22.
-- A draft is stored under a key; two different chats must never share one, or one chat's input shows up in the other.
-- Run: java -jar alloy.jar exec -f -o /tmp/out DraftKey.als (brew OpenJDK). Expected: the checks marked "counterexample" are SAT,
-- the ones marked "holds" UNSAT.

sig ChaId {}
sig ChatId {}
sig Char { cha: one ChaId, chats: set Chat }
sig Chat { id: one ChatId }

-- every chat sits in exactly one character; characters have distinct ids (chaId is a uuid made with the character)
fact { all c: Chat | one chats.c }
fact { all disj a, b: Char | a.cha != b.cha }

fun owner[c: Chat]: Char { chats.c }

-- the key schemes
pred sameKeyChatOnly[x, y: Chat] { x.id = y.id }                                  -- the chat id alone
pred sameKeyPair[x, y: Chat] { x.id = y.id and owner[x].cha = owner[y].cha }     -- (character, chat): shipped

-- the importer. Before: an imported chat kept the id it carried, so ids could repeat anywhere (no rule at all).
-- After: an id already in the save gets a new one, so no two chats in the save share an id.
pred importFresh { all disj x, y: Chat | x.id != y.id }
-- a weaker importer that only checked the target character's own chats
pred importFreshInChar { all ch: Char | all disj x, y: ch.chats | x.id != y.id }

-- counterexample: the chat id alone collides across characters (an export imported into a second character)
ChatIdOnly: check { all disj x, y: Chat | not sameKeyChatOnly[x, y] } for 4
-- counterexample: even the pair collides when the old importer runs twice into one character
PairOldImport: check { all disj x, y: Chat | not sameKeyPair[x, y] } for 4
-- holds: the pair never collides once ids are fresh within a character
PairFreshInChar: check { importFreshInChar => all disj x, y: Chat | not sameKeyPair[x, y] } for 6
-- counterexample: an importer fresh only within its character still lets the chat id alone collide (so the key needs the character)
ChatIdOnlyFreshInChar: check { importFreshInChar => all disj x, y: Chat | not sameKeyChatOnly[x, y] } for 4
-- holds: the shipped importer (fresh across the save) with the shipped key
PairShipped: check { importFresh => all disj x, y: Chat | not sameKeyPair[x, y] } for 6

-- the screen: the box has one owner, the open chat; a late dictation is tagged with the chat it started in.
sig Screen { shown: lone Chat, boxOwner: lone Chat, dictation: lone Chat }
-- drafts.open runs on every switch: the box's owner is the shown (open) chat
pred switchStores[s: Screen] { s.boxOwner = s.shown }
-- drafts.deliver: the words go to the tagged chat's box only when it is the box's owner, else to its stored draft
fun deliverTo[s: Screen]: lone Chat { s.dictation = s.boxOwner => s.boxOwner else s.dictation }
fun deliverOld[s: Screen]: lone Chat { s.shown }

-- counterexample: before, a dictation started in one chat landed in whatever chat was open
LateOld: check { all s: Screen | some s.dictation and some s.shown => deliverOld[s] = s.dictation } for 4
-- holds: after, it always lands in the chat it was spoken for
LateShipped: check { all s: Screen | switchStores[s] and some s.dictation => deliverTo[s] = s.dictation } for 6
-- holds: and the box only ever shows the open chat's words
BoxIsOpenChat: check { all s: Screen | switchStores[s] and some s.dictation and deliverTo[s] = s.boxOwner => s.dictation = s.shown } for 6
