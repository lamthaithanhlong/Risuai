// The three-way merge the server applies to a page's write (server/node/dbMerge.cjs mergeValues), on one level of keys. A value is
// represented by its hash (an int): only "same or different" matters.
//   b = what the page loaded (the base), o = what it is writing (ours), t = what the server has now (theirs)
// Rule: a key the page did not change follows the server; a key the page changed (or added) takes the page's value; a key deleted on
// one side stays deleted only if the other side did not change it.

type M = map<int, int>

predicate Unchanged(b: M, o: M, k: int) { k in b && k in o && o[k] == b[k] }

predicate Present(b: M, o: M, t: M, k: int)
{
  if k in o && k in t then true
  else if k in o then !(k in b && o[k] == b[k])    // the server deleted it: gone, unless the page changed it
  else if k in t then !(k in b && t[k] == b[k])    // the page deleted it: gone, unless the server changed it
  else false
}

function Val(b: M, o: M, t: M, k: int): int
  requires Present(b, o, t, k)
{
  if k in o && k in t then (if Unchanged(b, o, k) then t[k] else o[k])
  else if k in o then o[k]
  else t[k]
}

function Merge(b: M, o: M, t: M): M
{
  map k | k in (o.Keys + t.Keys) && Present(b, o, t, k) :: Val(b, o, t, k)
}

// the page did not touch a key and the server still has it: the server's value stays (no stale overwrite)
lemma UntouchedKeyFollowsServer(b: M, o: M, t: M, k: int)
  requires Unchanged(b, o, k) && k in t
  ensures k in Merge(b, o, t) && Merge(b, o, t)[k] == t[k]
{}

// the page changed or added a key: its value is kept (its own edit is never lost)
lemma ChangedKeyTakesPage(b: M, o: M, t: M, k: int)
  requires k in o && !Unchanged(b, o, k)
  ensures k in Merge(b, o, t) && Merge(b, o, t)[k] == o[k]
{}

// nobody else wrote since the page loaded: the result is exactly what the page wrote (the fast path loses nothing)
lemma NobodyElseWrote(b: M, o: M)
  ensures Merge(b, o, b) == o
{
  var r := Merge(b, o, b);
  assert forall k :: k in o ==> k in r && r[k] == o[k];
  assert forall k :: k in r ==> k in o;
}

// the page changed nothing: the result is exactly what the server has
lemma PageChangedNothing(b: M, t: M)
  ensures Merge(b, b, t) == t
{
  var r := Merge(b, b, t);
  assert forall k :: k in t ==> (k in r && r[k] == t[k]) || (k in b && t[k] == b[k]);
  assert forall k :: k in r ==> k in t;
}

// the same page writing again with the same base changes nothing the second time
lemma Idempotent(b: M, o: M, t: M)
  ensures Merge(b, o, Merge(b, o, t)) == Merge(b, o, t)
{
  var m := Merge(b, o, t);
  var m2 := Merge(b, o, m);
  assert forall k :: k in m2 <==> k in m;
  assert forall k :: k in m2 ==> m2[k] == m[k];
}

// nothing is invented: every value is the page's or the server's
lemma NoInvention(b: M, o: M, t: M, k: int)
  requires k in Merge(b, o, t)
  ensures (k in o && Merge(b, o, t)[k] == o[k]) || (k in t && Merge(b, o, t)[k] == t[k])
{}

// a key deleted by the page is not brought back unless the server changed it meanwhile; a key the server changed is never destroyed
lemma DeletionRespectsOthersEdits(b: M, o: M, t: M, k: int)
  requires k in b && !(k in o) && k in t
  ensures (t[k] == b[k]) ==> !(k in Merge(b, o, t))
  ensures (t[k] != b[k]) ==> (k in Merge(b, o, t) && Merge(b, o, t)[k] == t[k])
{}

// the other side deleted a key the page did not touch: it stays deleted; if the page changed it, the page's edit is kept
lemma ServerDeletionKeepsPageEdit(b: M, o: M, t: M, k: int)
  requires k in b && k in o && !(k in t)
  ensures Unchanged(b, o, k) ==> !(k in Merge(b, o, t))
  ensures !Unchanged(b, o, k) ==> (k in Merge(b, o, t) && Merge(b, o, t)[k] == o[k])
{}
