// segment() in src/ts/process/vietjiDict.ts: typed Vietnamese cut into the longest known words, greedy from the left,
// at most MAX syllables a word; a syllable that starts no known word is skipped. Proved for every input:
//   Words    each cut is a word of the list, 1..MAX syllables, inside the text
//   Ordered  cuts come in order and never overlap
//   Longest  no longer word of the list starts where a cut starts
//   Skipped  a syllable left out starts no word of the list (so needsModel's "covered < syllables" means a missing word)
// Run: dafny verify docs/specs/Segment.dfy   (Dafny 4.11, 2026-10-15: verified)

datatype Cut = Cut(start: nat, len: nat)

predicate WordAt(s: seq<string>, dict: set<seq<string>>, i: nat, n: nat)
{
  i + n <= |s| && s[i..i+n] in dict
}

predicate NoWordAt(s: seq<string>, dict: set<seq<string>>, max: nat, i: nat)
{
  forall n :: 1 <= n <= max ==> !WordAt(s, dict, i, n)
}

predicate Covered(out: seq<Cut>, p: nat)
{
  exists k :: 0 <= k < |out| && out[k].start <= p < out[k].start + out[k].len
}

predicate Good(s: seq<string>, dict: set<seq<string>>, max: nat, out: seq<Cut>, upto: nat)
{
  (forall k :: 0 <= k < |out| ==>
      1 <= out[k].len <= max && WordAt(s, dict, out[k].start, out[k].len) && out[k].start + out[k].len <= upto
      && forall n :: out[k].len < n <= max ==> !WordAt(s, dict, out[k].start, n))
  && (forall k :: 0 <= k < |out| - 1 ==> out[k].start + out[k].len <= out[k+1].start)
}

method Segment(s: seq<string>, dict: set<seq<string>>, max: nat) returns (out: seq<Cut>)
  requires max >= 1
  ensures Good(s, dict, max, out, |s|)
  ensures forall p :: 0 <= p < |s| && !Covered(out, p) ==> NoWordAt(s, dict, max, p)
{
  out := [];
  var i := 0;
  while i < |s|
    invariant 0 <= i <= |s|
    invariant Good(s, dict, max, out, i)
    invariant |out| > 0 ==> out[|out|-1].start + out[|out|-1].len <= i
    invariant forall p :: 0 <= p < i && !Covered(out, p) ==> NoWordAt(s, dict, max, p)
    decreases |s| - i
  {
    var n := if max < |s| - i then max else |s| - i;
    var found := 0;
    while n >= 1
      invariant 0 <= n <= max
      invariant n <= |s| - i
      invariant forall m :: n < m <= max ==> !WordAt(s, dict, i, m)
      decreases n
    {
      if s[i..i+n] in dict { found := n; break; }
      n := n - 1;
    }
    if found > 0 {
      var old_out := out;
      out := out + [Cut(i, found)];
      forall p | 0 <= p < i + found && !Covered(out, p) ensures NoWordAt(s, dict, max, p) {
        if p < i {
          assert !Covered(old_out, p) by {
            if Covered(old_out, p) {
              var k :| 0 <= k < |old_out| && old_out[k].start <= p < old_out[k].start + old_out[k].len;
              assert out[k] == old_out[k];
            }
          }
        } else {
          assert out[|out|-1].start <= p < out[|out|-1].start + out[|out|-1].len;
          assert false;
        }
      }
      i := i + found;
    } else {
      assert NoWordAt(s, dict, max, i);
      forall p | 0 <= p < i + 1 && !Covered(out, p) ensures NoWordAt(s, dict, max, p) { }
      i := i + 1;
    }
  }
}
