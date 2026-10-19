// The Thai cutter in src/ts/process/vietjiThai.ts never loses or adds a character (dafny verify docs/specs/ThaiSegment.dfy).
//
// Both of its cutters (parseRun: syllables by rule; thaiWords: list words, maximal matching) are the same scanner over an
// abstract alphabet: from every position already reached, each candidate piece (an oracle: the rules' syllables, the list's
// words) and always the one-character fallback (a stray mark) relax the cost of the position it ends at, keeping a pointer back;
// then the pieces are read back from the end. Afterwards pieces next to each other are joined (a syllable said with an unwritten
// a joins the one after it; unknown stretches join into one). Proved here, for any oracle and any costs:
//   - the end is always reached, so there is always a cut;
//   - the pieces read back are not empty and, joined, are exactly the input;
//   - joining neighbours keeps that.

function Concat<T>(ps: seq<seq<T>>): seq<T>
{
  if |ps| == 0 then [] else ps[0] + Concat(ps[1..])
}

lemma ConcatPrepend<T>(x: seq<T>, ps: seq<seq<T>>)
  ensures Concat([x] + ps) == x + Concat(ps)
{
  assert ([x] + ps)[1..] == ps;
}

/** The scanner: cands[i] are the ends of the candidate pieces at i, cost(i, e) what taking s[i..e] costs. */
method Scan<T>(s: seq<T>, cands: seq<set<nat>>, cost: (nat, nat) -> nat) returns (pieces: seq<seq<T>>)
  requires |cands| == |s|
  requires forall i, e :: 0 <= i < |s| && e in cands[i] ==> i < e <= |s|
  ensures Concat(pieces) == s
  ensures forall k :: 0 <= k < |pieces| ==> |pieces[k]| > 0
{
  var n := |s|;
  var reached := new bool[n + 1](_ => false);
  var best := new nat[n + 1](_ => 0);
  var prev := new nat[n + 1](_ => 0);
  reached[0] := true;
  var i := 0;
  while i < n
    invariant 0 <= i <= n
    invariant forall j :: 0 <= j <= i ==> reached[j]
    invariant forall e :: 0 < e <= n && reached[e] ==> prev[e] < e && reached[prev[e]]
    invariant reached[0]
  {
    // the candidates, then the one-character fallback
    var ends := cands[i] + {i + 1};
    while ends != {}
      invariant forall j :: 0 <= j <= i ==> reached[j]
      invariant forall e :: 0 < e <= n && reached[e] ==> prev[e] < e && reached[prev[e]]
      invariant forall e :: e in ends ==> i < e <= n
      invariant reached[0]
      invariant (i + 1) !in ends ==> reached[i + 1]
      decreases ends
    {
      var e :| e in ends;
      var c := best[i] + cost(i, e);
      if !reached[e] || c < best[e] {
        reached[e] := true;
        best[e] := c;
        prev[e] := i;
      }
      ends := ends - {e};
    }
    i := i + 1;
  }
  // read back from the end (the end is reached: every position is)
  assert reached[n];
  pieces := [];
  var e := n;
  while e > 0
    invariant 0 <= e <= n
    invariant reached[e]
    invariant forall e' :: 0 < e' <= n && reached[e'] ==> prev[e'] < e' && reached[prev[e']]
    invariant Concat(pieces) == s[e..]
    invariant forall k :: 0 <= k < |pieces| ==> |pieces[k]| > 0
    decreases e
  {
    var p := prev[e];
    ConcatPrepend(s[p..e], pieces);
    assert s[p..e] + s[e..] == s[p..];
    pieces := [s[p..e]] + pieces;
    e := p;
  }
}

/** Joining piece k with the one after it (join[k]) keeps the text: the unwritten-a merge and the unknown-stretch merge. */
function Join<T>(ps: seq<seq<T>>, join: seq<bool>): seq<seq<T>>
  requires |join| == |ps|
  decreases |ps|
{
  if |ps| <= 1 then ps
  else if join[0] then Join([ps[0] + ps[1]] + ps[2..], [join[1]] + join[2..])
  else [ps[0]] + Join(ps[1..], join[1..])
}

lemma JoinKeepsText<T>(ps: seq<seq<T>>, join: seq<bool>)
  requires |join| == |ps|
  ensures Concat(Join(ps, join)) == Concat(ps)
  decreases |ps|
{
  if |ps| <= 1 {
  } else if join[0] {
    var rest := [ps[0] + ps[1]] + ps[2..];
    JoinKeepsText(rest, [join[1]] + join[2..]);
    ConcatPrepend(ps[0] + ps[1], ps[2..]);
    assert ps[1..][1..] == ps[2..];
    ConcatPrepend(ps[1], ps[2..]);
    assert [ps[1]] + ps[2..] == ps[1..];
  } else {
    JoinKeepsText(ps[1..], join[1..]);
    ConcatPrepend(ps[0], Join(ps[1..], join[1..]));
  }
}

lemma JoinKeepsNonEmpty<T>(ps: seq<seq<T>>, join: seq<bool>)
  requires |join| == |ps|
  requires forall k :: 0 <= k < |ps| ==> |ps[k]| > 0
  ensures forall k :: 0 <= k < |Join(ps, join)| ==> |Join(ps, join)[k]| > 0
  decreases |ps|
{
  if |ps| <= 1 {
  } else if join[0] {
    JoinKeepsNonEmpty([ps[0] + ps[1]] + ps[2..], [join[1]] + join[2..]);
  } else {
    JoinKeepsNonEmpty(ps[1..], join[1..]);
  }
}

/** The whole path: scan, then join; the units shown are the input, none empty. */
method Units<T>(s: seq<T>, cands: seq<set<nat>>, cost: (nat, nat) -> nat, join: seq<bool>) returns (units: seq<seq<T>>)
  requires |cands| == |s|
  requires forall i, e :: 0 <= i < |s| && e in cands[i] ==> i < e <= |s|
  ensures Concat(units) == s
  ensures forall k :: 0 <= k < |units| ==> |units[k]| > 0
{
  var pieces := Scan(s, cands, cost);
  var j := if |join| == |pieces| then join else seq(|pieces|, _ => false);
  JoinKeepsText(pieces, j);
  JoinKeepsNonEmpty(pieces, j);
  units := Join(pieces, j);
}
