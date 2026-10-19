// dbMerge.cjs mergeById + interleaveByTime (the code since the F1 fix), proved for ANY list of id-carrying elements, so it can be reused one level down: on the
// messages of a chat (Risu's chatId) when both pages changed the same chat. Today it is applied to the chats only, and a chat both
// pages changed is taken whole from the writing page (ChatMergeCurrent.dfy shows the loss).
//   b: what the page loaded, as id -> version hash (the manifest's elems); o: what the page writes; t: what the server has.
datatype Msg = Msg(id: int, v: int, time: int)

predicate Distinct(s: seq<Msg>) { forall i, j :: 0 <= i < j < |s| ==> s[i].id != s[j].id }
predicate HasId(s: seq<Msg>, id: int) { exists k :: 0 <= k < |s| && s[k].id == id }
function Find(s: seq<Msg>, id: int): Msg requires HasId(s, id) { if s[0].id == id then s[0] else Find(s[1..], id) }
predicate Untouched(b: map<int, int>, m: Msg) { m.id in b && b[m.id] == m.v }

// the page's elements, in the page's order: untouched -> the server's version (or gone if the server deleted it), else the page's
function PartO(b: map<int, int>, o: seq<Msg>, t: seq<Msg>): seq<Msg>
{
  if |o| == 0 then []
  else
    var m := o[0];
    var head := if HasId(t, m.id) && Untouched(b, m) then [Find(t, m.id)]
                else if !HasId(t, m.id) && Untouched(b, m) then []
                else [m];
    head + PartO(b, o[1..], t)
}
// what only the server has, in its order: added by it, or changed by it after the page deleted it
function PartT(b: map<int, int>, o: seq<Msg>, t: seq<Msg>): seq<Msg>
{
  if |t| == 0 then []
  else
    var m := t[0];
    (if !HasId(o, m.id) && !Untouched(b, m) then [m] else []) + PartT(b, o, t[1..])
}
function MergeById(b: map<int, int>, o: seq<Msg>, t: seq<Msg>): seq<Msg> { PartO(b, o, t) + PartT(b, o, t) }

lemma FindIn(s: seq<Msg>, id: int) requires HasId(s, id) ensures Find(s, id) in s && Find(s, id).id == id {}
lemma PartOIds(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, x: Msg)
  requires x in PartO(b, o, t) ensures HasId(o, x.id)
{
  if |o| > 0 {
    if HasId(t, o[0].id) { FindIn(t, o[0].id); }
    if x in PartO(b, o[1..], t) { PartOIds(b, o[1..], t, x); var k :| 0 <= k < |o[1..]| && o[1..][k].id == x.id; assert o[k+1].id == x.id; }
    else { assert x.id == o[0].id; }
  }
}
lemma PartTIds(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, x: Msg)
  requires x in PartT(b, o, t) ensures x in t && !HasId(o, x.id)
{ if |t| > 0 && x !in (if !HasId(o, t[0].id) && !Untouched(b, t[0]) then [t[0]] else []) { PartTIds(b, o, t[1..], x); } }

lemma PartODistinct(b: map<int, int>, o: seq<Msg>, t: seq<Msg>)
  requires Distinct(o) ensures Distinct(PartO(b, o, t))
{
  if |o| > 0 {
    PartODistinct(b, o[1..], t);
    var rest := PartO(b, o[1..], t);
    forall x | x in rest ensures x.id != o[0].id { PartOIds(b, o[1..], t, x); }
    if HasId(t, o[0].id) { FindIn(t, o[0].id); }
  }
}
lemma PartTDistinct(b: map<int, int>, o: seq<Msg>, t: seq<Msg>)
  requires Distinct(t) ensures Distinct(PartT(b, o, t))
{
  if |t| > 0 {
    PartTDistinct(b, o, t[1..]);
    forall x | x in PartT(b, o, t[1..]) ensures x.id != t[0].id { PartTIds(b, o, t[1..], x); var k :| 0 <= k < |t[1..]| && t[1..][k] == x; }
  }
}
// no message appears twice
lemma NoDuplicate(b: map<int, int>, o: seq<Msg>, t: seq<Msg>)
  requires Distinct(o) && Distinct(t) ensures Distinct(MergeById(b, o, t))
{
  PartODistinct(b, o, t); PartTDistinct(b, o, t);
  var p, q := PartO(b, o, t), PartT(b, o, t);
  forall i, j | 0 <= i < |p| && 0 <= j < |q| ensures p[i].id != q[j].id { PartOIds(b, o, t, p[i]); PartTIds(b, o, t, q[j]); }
}
// a message the other device added and this page never had is kept
lemma NoAppendLost(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in t && m.id !in b && !HasId(o, m.id) ensures m in MergeById(b, o, t)
{ AppendInPartT(b, o, t, m); }
lemma AppendInPartT(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in t && !Untouched(b, m) && !HasId(o, m.id) ensures m in PartT(b, o, t)
{ if t[0] != m { AppendInPartT(b, o, t[1..], m); } }
// a message this page added or edited stays as the page wrote it
lemma OwnEditKept(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in o && !Untouched(b, m) ensures m in MergeById(b, o, t)
{ OwnInPartO(b, o, t, m); }
lemma OwnInPartO(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in o && !Untouched(b, m) ensures m in PartO(b, o, t)
{ if o[0] != m { OwnInPartO(b, o[1..], t, m); } }
// a message the page did not touch follows the server (an edit or a regeneration done on the other device wins)
lemma UntouchedFollowsServer(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in o && Untouched(b, m) && HasId(t, m.id) ensures Find(t, m.id) in MergeById(b, o, t)
{ UntouchedInPartO(b, o, t, m); }
lemma UntouchedInPartO(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, m: Msg)
  requires m in o && Untouched(b, m) && HasId(t, m.id) ensures Find(t, m.id) in PartO(b, o, t)
{ if o[0] != m { UntouchedInPartO(b, o[1..], t, m); } }
// nobody else wrote (the server still has what the page loaded): the result is exactly the page's chat
lemma NobodyElseWrote(o: seq<Msg>, t: seq<Msg>, b: map<int, int>)
  requires forall m :: m in t ==> Untouched(b, m)
  ensures PartT(b, o, t) == []
{ if |t| > 0 { NobodyElseWrote(o, t[1..], b); } }

// ---- the code since F1: for messages the two runs are merged by time (interleaveByTime), each run keeping its own order --------
function Interleave(a: seq<Msg>, b: seq<Msg>): seq<Msg>
  decreases |a| + |b|
{
  if |a| == 0 then b else if |b| == 0 then a
  else if b[0].time < a[0].time then [b[0]] + Interleave(a, b[1..])
  else [a[0]] + Interleave(a[1..], b)
}
function MergeMessages(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, timed: bool): seq<Msg>
{ if timed then Interleave(PartO(b, o, t), PartT(b, o, t)) else MergeById(b, o, t) }

lemma InterleaveSameElements(a: seq<Msg>, b: seq<Msg>)
  ensures multiset(Interleave(a, b)) == multiset(a) + multiset(b)
  decreases |a| + |b|
{
  if |a| == 0 || |b| == 0 {}
  else if b[0].time < a[0].time { InterleaveSameElements(a, b[1..]); assert b == [b[0]] + b[1..]; }
  else { InterleaveSameElements(a[1..], b); assert a == [a[0]] + a[1..]; }
}
predicate Disjoint(a: seq<Msg>, b: seq<Msg>) { forall x, y :: x in a && y in b ==> x.id != y.id }
lemma InterleaveMembers(a: seq<Msg>, b: seq<Msg>, x: Msg)
  ensures x in Interleave(a, b) <==> (x in a || x in b)
{
  InterleaveSameElements(a, b);
  assert x in Interleave(a, b) <==> x in multiset(Interleave(a, b));
  assert x in a <==> x in multiset(a);
  assert x in b <==> x in multiset(b);
}
lemma TailDistinct(s: seq<Msg>) requires |s| > 0 && Distinct(s) ensures Distinct(s[1..]) && forall x :: x in s[1..] ==> x.id != s[0].id
{
  forall x | x in s[1..] ensures x.id != s[0].id { var k :| 0 <= k < |s[1..]| && s[1..][k] == x; assert s[k + 1] == x; }
}
lemma ConsDistinct(h: Msg, r: seq<Msg>) requires Distinct(r) && (forall x :: x in r ==> x.id != h.id) ensures Distinct([h] + r)
{
  forall i, j | 0 <= i < j < |[h] + r| ensures ([h] + r)[i].id != ([h] + r)[j].id {
    if i == 0 { assert ([h] + r)[j] == r[j - 1]; assert r[j - 1] in r; } else { assert ([h] + r)[i] == r[i - 1] && ([h] + r)[j] == r[j - 1]; }
  }
}
lemma InterleaveDistinct(a: seq<Msg>, b: seq<Msg>)
  requires Distinct(a) && Distinct(b) && Disjoint(a, b) ensures Distinct(Interleave(a, b))
  decreases |a| + |b|
{
  if |a| == 0 || |b| == 0 {}
  else if b[0].time < a[0].time {
    TailDistinct(b);
    InterleaveDistinct(a, b[1..]);
    forall x | x in Interleave(a, b[1..]) ensures x.id != b[0].id { InterleaveMembers(a, b[1..], x); }
    ConsDistinct(b[0], Interleave(a, b[1..]));
  } else {
    TailDistinct(a);
    InterleaveDistinct(a[1..], b);
    forall x | x in Interleave(a[1..], b) ensures x.id != a[0].id { InterleaveMembers(a[1..], b, x); }
    ConsDistinct(a[0], Interleave(a[1..], b));
  }
}
lemma PartsDisjoint(b: map<int, int>, o: seq<Msg>, t: seq<Msg>) ensures Disjoint(PartO(b, o, t), PartT(b, o, t))
{
  forall x, y | x in PartO(b, o, t) && y in PartT(b, o, t) ensures x.id != y.id { PartOIds(b, o, t, x); PartTIds(b, o, t, y); }
}
// the four properties hold for the code as shipped, timed or not
lemma Shipped(b: map<int, int>, o: seq<Msg>, t: seq<Msg>, timed: bool, m: Msg)
  requires Distinct(o) && Distinct(t)
  ensures Distinct(MergeMessages(b, o, t, timed))
  ensures (m in t && m.id !in b && !HasId(o, m.id)) ==> m in MergeMessages(b, o, t, timed)
  ensures (m in o && !Untouched(b, m)) ==> m in MergeMessages(b, o, t, timed)
  ensures (m in o && Untouched(b, m) && HasId(t, m.id)) ==> Find(t, m.id) in MergeMessages(b, o, t, timed)
{
  NoDuplicate(b, o, t);
  PartODistinct(b, o, t); PartTDistinct(b, o, t); PartsDisjoint(b, o, t);
  InterleaveDistinct(PartO(b, o, t), PartT(b, o, t));
  if m in t && m.id !in b && !HasId(o, m.id) { AppendInPartT(b, o, t, m); InterleaveMembers(PartO(b, o, t), PartT(b, o, t), m); }
  if m in o && !Untouched(b, m) { OwnInPartO(b, o, t, m); InterleaveMembers(PartO(b, o, t), PartT(b, o, t), m); }
  if m in o && Untouched(b, m) && HasId(t, m.id) { UntouchedInPartO(b, o, t, m); InterleaveMembers(PartO(b, o, t), PartT(b, o, t), Find(t, m.id)); }
}
