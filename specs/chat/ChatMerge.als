// One chat, merged when two pages both changed it (server/node/dbMerge.cjs mergeById: a chat is ONE element, hashed whole).
// A chat is a partial map from message id (Risu's chatId) to a version of that message.
//   Base = the chat the writing page loaded, Ours = the chat it writes, Theirs = the chat the server has now.
// Old rule (dbMerge.cjs:147-157 at d588ddef): if the page's chat hashes like the base -> the server's chat, else the page's chat, whole.
// Fixed rule = the code since F1: the same three-way rule applied once more, per message id (mergeById with key 'chatId').
// The order of the result (page order, or both runs merged by time) is proved in MessageMerge.dfy, not here.
sig Id {}
sig Ver {}
abstract sig Side {}
one sig Base, Ours, Theirs, Cur, Fix extends Side {}
sig World { msg: Side -> Id -> lone Ver }

fun at[w: World, s: Side, i: Id]: lone Ver { i.(s.(w.msg)) }
pred same[w: World, s1, s2: Side] { all i: Id | at[w, s1, i] = at[w, s2, i] }

// the code: the whole chat from one side
pred current[w: World] {
  same[w, Ours, Base] => (all i: Id | at[w, Cur, i] = at[w, Theirs, i])
                     else (all i: Id | at[w, Cur, i] = at[w, Ours, i])
}
// the fix: per message id, the page's version if it changed (added, edited, deleted) that message, else the server's
pred fixed[w: World] {
  all i: Id | at[w, Ours, i] = at[w, Base, i] => at[w, Fix, i] = at[w, Theirs, i] else at[w, Fix, i] = at[w, Ours, i]
}
// a deliberately wrong fix: the server's version unless the server left it alone (server wins when both changed)
pred serverWins[w: World] {
  all i: Id | at[w, Theirs, i] = at[w, Base, i] => at[w, Fix, i] = at[w, Ours, i] else at[w, Fix, i] = at[w, Theirs, i]
}

// a message the other device added (not in the base) and this page never had is kept
pred noAppendLost[w: World, r: Side] { all i: Id | (no at[w, Base, i] and no at[w, Ours, i] and some at[w, Theirs, i]) => at[w, r, i] = at[w, Theirs, i] }
// a message this page added or edited is kept as the page wrote it
pred ownEditKept[w: World, r: Side] { all i: Id | (at[w, Ours, i] != at[w, Base, i] and some at[w, Ours, i]) => at[w, r, i] = at[w, Ours, i] }

assert CurrentKeepsAppends  { all w: World | current[w] => noAppendLost[w, Cur] }
assert FixKeepsAppends      { all w: World | fixed[w] => noAppendLost[w, Fix] and ownEditKept[w, Fix] }
assert ServerWinsKeepsEdits { all w: World | serverWins[w] => ownEditKept[w, Fix] }
check CurrentKeepsAppends for 4 but 1 World      // expect a counterexample
check FixKeepsAppends for 6 but 1 World          // expect none
check ServerWinsKeepsEdits for 4 but 1 World     // expect a counterexample (the break)
run { some w: World | fixed[w] and (some i: Id | some at[w, Ours, i] and at[w, Ours, i] != at[w, Base, i]) and (some j: Id | no at[w, Base, j] and some at[w, Theirs, j]) } for 4 but 1 World
