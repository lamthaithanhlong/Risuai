// RED on purpose (the code before the F1 fix, d588ddef). The rule dbMerge.cjs applied to a chat both pages changed: the chat is one element, hashed whole, and the writing
// page's copy wins (mergeById line 156 `out.push(o)`). Dafny must reject NoAppendLost here.
datatype Msg = Msg(id: int, v: int, time: int)
predicate HasId(s: seq<Msg>, id: int) { exists k :: 0 <= k < |s| && s[k].id == id }
function ChatLevel(base: seq<Msg>, o: seq<Msg>, t: seq<Msg>): seq<Msg> { if o == base then t else o }
lemma NoAppendLost(base: seq<Msg>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in t && !HasId(base, m.id) && !HasId(o, m.id)
  ensures m in ChatLevel(base, o, t)
{}
// the same break inside the fixed function: PartT that keeps only what the base already had
function PartTBroken(b: map<int, int>, o: seq<Msg>, t: seq<Msg>): seq<Msg>
{ if |t| == 0 then [] else (if !HasId(o, t[0].id) && t[0].id in b && b[t[0].id] != t[0].v then [t[0]] else []) + PartTBroken(b, o, t[1..]) }
lemma BrokenNoAppendLost(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in t && m.id !in b && !HasId(o, m.id) ensures m in PartTBroken(b, o, t)
{ if t[0] != m { BrokenNoAppendLost(b, o, t[1..], m); } }
// and a broken interleave that drops the rest of the server's run once the page's run ends
function InterleaveBroken(a: seq<Msg>, b: seq<Msg>): seq<Msg> decreases |a| + |b|
{ if |a| == 0 then [] else if |b| == 0 then a else if b[0].time < a[0].time then [b[0]] + InterleaveBroken(a, b[1..]) else [a[0]] + InterleaveBroken(a[1..], b) }
lemma BrokenInterleaveKeeps(a: seq<Msg>, b: seq<Msg>) ensures multiset(InterleaveBroken(a, b)) == multiset(a) + multiset(b) {}
