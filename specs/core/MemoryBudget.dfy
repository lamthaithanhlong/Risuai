// HypaV3 memory token budget (hypav3.ts hypaMemoryV3Main, "Select important / recent / similar / random summaries").
// Ratios are held in per mille (r = 300 means 0.3) so the arithmetic stays exact; Math.floor(A * ratio) is Share(A, ratio).
// Proved: the memory the four selections take never exceeds the memory budget, whatever each selection consumes within its own
// reservation and whether or not a selection is skipped (the similarity search is skipped on iOS by the embedding guard).

function Share(a: int, p: int): int
  requires a >= 0 && 0 <= p <= 1000
{ a * p / 1000 }

// floor(x/1000) + floor(y/1000) + floor(z/1000) <= floor((x+y+z)/1000)
lemma FloorsSumBelow(x: int, y: int, z: int)
  requires x >= 0 && y >= 0 && z >= 0
  ensures x / 1000 + y / 1000 + z / 1000 <= (x + y + z) / 1000
{
  assert x == 1000 * (x / 1000) + x % 1000;
  assert y == 1000 * (y / 1000) + y % 1000;
  assert z == 1000 * (z / 1000) + z % 1000;
}

lemma SharesFit(a: int, r: int, s: int)
  requires a >= 0 && r >= 0 && s >= 0 && r + s <= 1000
  ensures Share(a, r) + Share(a, s) + Share(a, 1000 - r - s) <= a
  ensures Share(a, r) >= 0 && Share(a, s) >= 0 && Share(a, 1000 - r - s) >= 0
{
  FloorsSumBelow(a * r, a * s, a * (1000 - r - s));
  assert a * r + a * s + a * (1000 - r - s) == a * 1000;
}

// The code: reserve recent = Share(A,r). Consume c1 <= reserve. Similar reserve = Share(A,s), plus the unused recent reserve when
// there is no random share (t == 0). Random reserve = Share(A,t) plus the unused recent and similar reserves (only when t > 0).
// Whatever each selection consumes inside its own reservation (c1, c2, c3), the sum stays within A.
lemma TotalWithinBudget(a: int, r: int, s: int, c1: int, c2: int, c3: int)
  requires a >= 0 && r >= 0 && s >= 0 && r + s <= 1000
  requires 0 <= c1 <= Share(a, r)
  requires 0 <= c2 && 0 <= c3
  // regime 1: no random share. Similar may use what recent left over; random is not run (c3 == 0)
  ensures r + s == 1000 ==> c2 <= Share(a, s) + (Share(a, r) - c1) && c3 == 0 ==> c1 + c2 + c3 <= a
  // regime 2: a random share. Similar uses only its own share; random may use everything the others left over
  ensures r + s < 1000 ==>
    (c2 <= Share(a, s) &&
     c3 <= Share(a, 1000 - r - s) + (Share(a, r) - c1) + (Share(a, s) - c2))
    ==> c1 + c2 + c3 <= a
{
  SharesFit(a, r, s);
}

// important summaries are taken first, each only while it still fits: what is left is the budget of the rest, never negative
method TakeImportant(budget: int, sizes: seq<int>) returns (left: int, taken: int)
  requires budget >= 0
  requires forall i :: 0 <= i < |sizes| ==> sizes[i] >= 0
  ensures 0 <= left && taken >= 0 && left + taken == budget
{
  left := budget;
  taken := 0;
  var i := 0;
  while i < |sizes|
    invariant 0 <= left && taken >= 0 && left + taken == budget
  {
    if sizes[i] > left { break; }
    left := left - sizes[i];
    taken := taken + sizes[i];
    i := i + 1;
  }
}
