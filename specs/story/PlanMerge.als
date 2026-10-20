// The Future Plan line under the chat merge (dbMerge.cjs mergeById per message, specs/chat/ChatMerge.als `fixed`) and the
// cards' status.lua dropOldPlans (every older reply loses its line when a reply comes, Dafny plans.dfy).
// Question: with two devices (desktop, phone) on one chat, can the merged chat hold more than one plan line, and does it heal?
open util/ordering[Pos]
sig Pos {}                                    // message positions, in chat order
abstract sig Side {}
one sig Base, Ours, Theirs, Merged extends Side {}
sig World {
  msg: Side -> Pos -> lone Ver
}
sig Ver { plan: lone Pos }                    // a message version; plan = this version carries a plan line (at its own pos)
fact planAtOwnPos { all w: World, s: Side, p: Pos, v: Ver | v = p.(s.(w.msg)) and some v.plan => v.plan = p }
fun at[w: World, s: Side, p: Pos]: lone Ver { p.(s.(w.msg)) }
fun newest[w: World, s: Side]: lone Pos { { p: Pos | some at[w, s, p] and no q: p.nexts | some at[w, s, q] } }
// dropOldPlans held on each device when it wrote: only its newest message may carry a line
pred clean[w: World, s: Side] { all p: Pos | some at[w, s, p].plan => p = newest[w, s] }
// the merge, per message: the writing page's version if it changed that message, else the server's
pred merged[w: World] { all p: Pos | at[w, Ours, p] = at[w, Base, p] => at[w, Merged, p] = at[w, Theirs, p] else at[w, Merged, p] = at[w, Ours, p] }
fun lines[w: World, s: Side]: set Pos { { p: Pos | some at[w, s, p].plan } }

// both devices start clean from the same chat, each adds its own reply and cleans, the phone's write is merged on the server
assert OnePlanAfterMerge { all w: World | clean[w, Base] and clean[w, Ours] and clean[w, Theirs] and merged[w] => lone lines[w, Merged] }
check OnePlanAfterMerge for 5 but 1 World     // expect a counterexample: two replies appended on two devices

// the next reply on either device runs dropOldPlans over the merged chat: it keeps only its own newest line
pred nextReply[w: World] { all p: Pos | p != newest[w, Merged] => no at[w, Merged, p].plan or p = newest[w, Merged] }
assert HealsOnNextReply { all w: World | merged[w] and nextReply[w] => lone lines[w, Merged] }
check HealsOnNextReply for 5 but 1 World      // expect none

// the fix in the app (loreIndex.ts onlyNewestPlan): the key pass and the picker read only the newest reply's line, whatever
// the stored chat holds; the merged chat may keep two lines, the lore passes see at most one
fun seen[w: World]: set Pos { lines[w, Merged] & newest[w, Merged] }
assert LorePassSeesOne { all w: World | clean[w, Base] and clean[w, Ours] and clean[w, Theirs] and merged[w] => lone seen[w] }
check LorePassSeesOne for 5 but 1 World       // expect none
