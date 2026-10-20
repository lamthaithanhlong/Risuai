// The librarian's budget (src/ts/process/loreIndex.ts fitBudget, indexActivation; asked 2026-10-20: "never the creation turns'
// rules dropped"). On a creation turn the creation shelf's books are activated as `forced` and passed to fitBudget with
// always = true, so the budget pass sorts them with the always-on rules, before any lore. Whole entries are modelled (the
// part-cut of an entry that does not fit only adds what is left, never takes a kept entry out).
//
//   Kept(xs, B)        the greedy pass over xs in order: an entry is kept when it fits what is left of B
//   AlwaysFirst(xs)    no always entry after a lore entry (fitBudget's sort)
//   RulesKept          AlwaysFirst and the always entries fit B together => every always entry is kept
//   ByOrderLoses       the old order (insertion order only: a picked entry with a higher order first) can drop a rule
//
//   dafny verify specs/story/Librarian.dfy

datatype Act = Act(tokens: nat, always: bool)

function Sum(xs: seq<Act>): nat { if |xs| == 0 then 0 else xs[0].tokens + Sum(xs[1..]) }
function AlwaysSum(xs: seq<Act>): nat { if |xs| == 0 then 0 else (if xs[0].always then xs[0].tokens else 0) + AlwaysSum(xs[1..]) }

// the entries kept, as booleans in the order of xs, with `left` tokens of room
function Kept(xs: seq<Act>, left: nat): seq<bool>
  ensures |Kept(xs, left)| == |xs|
{
  if |xs| == 0 then []
  else if xs[0].tokens <= left then [true] + Kept(xs[1..], left - xs[0].tokens)
  else [false] + Kept(xs[1..], left)
}

predicate AlwaysFirst(xs: seq<Act>) { forall i, j :: 0 <= i < j < |xs| && xs[j].always ==> xs[i].always }

lemma RulesKept(xs: seq<Act>, left: nat)
  requires AlwaysFirst(xs)
  requires AlwaysSum(xs) <= left
  ensures forall i :: 0 <= i < |xs| && xs[i].always ==> Kept(xs, left)[i]
{
  if |xs| > 0 {
    var rest := xs[1..];
    assert AlwaysFirst(rest) by { forall i, j | 0 <= i < j < |rest| && rest[j].always ensures rest[i].always { assert xs[i + 1].always; } }
    if xs[0].always {
      assert xs[0].tokens <= left;
      RulesKept(rest, left - xs[0].tokens);
    } else {
      // a lore entry first: then no always entry follows, and nothing is asked of the rest
      forall i | 0 <= i < |xs| && xs[i].always ensures false { if i > 0 { assert xs[0].always; } }
    }
  }
}

// the old pass (Risu's own, before 43e3b48a): by insertion order only. A picked entry with a high order first, the creation
// rules after it: with a budget of 10, the 8-token pick takes the room and the 5-token rule is dropped.
lemma ByOrderLoses()
  ensures var xs := [Act(8, false), Act(5, true)]; AlwaysSum(xs) <= 10 && !Kept(xs, 10)[1]
{
  var xs := [Act(8, false), Act(5, true)];
  assert Kept(xs, 10) == [true] + Kept(xs[1..], 2);
  assert Kept(xs[1..], 2) == [false] + Kept(xs[2..], 2);
}

// sorting the forced creation books with the rules (always = true) is what makes RulesKept apply to them
lemma CreationKeptWhenSorted(rules: seq<Act>, lore: seq<Act>, left: nat)
  requires forall i :: 0 <= i < |rules| ==> rules[i].always
  requires forall i :: 0 <= i < |lore| ==> !lore[i].always
  requires AlwaysSum(rules + lore) <= left
  ensures forall i :: 0 <= i < |rules| ==> Kept(rules + lore, left)[i]
{
  var xs := rules + lore;
  assert AlwaysFirst(xs) by {
    forall i, j | 0 <= i < j < |xs| && xs[j].always ensures xs[i].always {
      if j >= |rules| { assert xs[j] == lore[j - |rules|]; }
      assert i < |rules|;
      assert xs[i] == rules[i];
    }
  }
  RulesKept(xs, left);
  forall i | 0 <= i < |rules| ensures Kept(xs, left)[i] { assert xs[i] == rules[i]; }
}
