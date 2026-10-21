// storyGraph.cjs syncChat firstSeen, and story/gm/graph.lp weaker/3 (2026-10-21).
// FirstSeen: the turn a ledger line is dated by is never after now, and a line seen before keeps its turn unless a reroll took
// that turn back. Weaker: what follows from two premises is never stronger than either (fact 2 > rumor 1).

function FirstSeen(seen: int, turn: nat): nat
  // seen < 0: no kg_seen row (a new line, or a line that left the ledger and lost its row)
{
  if seen < 0 || seen > turn then turn else seen as nat
}

lemma FirstSeenNotFuture(seen: int, turn: nat)
  ensures FirstSeen(seen, turn) <= turn
{}

lemma FirstSeenStable(seen: int, turn: nat)
  requires 0 <= seen <= turn
  ensures FirstSeen(seen, turn) == seen
{}

// a sync after every change (GraphSync.tla LAG = FALSE): a new line is dated by the turn it was added, which is now
lemma NewLineIsNow(turn: nat)
  ensures FirstSeen(-1, turn) == turn
{}

datatype Status = Fact | Rumor
function Strength(s: Status): int { if s == Fact then 2 else 1 }
function Weaker(a: Status, b: Status): Status { if Strength(a) <= Strength(b) then a else b }

lemma WeakerNeverStronger(a: Status, b: Status)
  ensures Strength(Weaker(a, b)) <= Strength(a) && Strength(Weaker(a, b)) <= Strength(b)
{}

lemma ChainStaysWeak(a: Status, b: Status, c: Status)
  // a derivation over a derivation (within(X,P2) :- within(X,P1), part_of(P1,P2)): a rumor anywhere keeps it a rumor
  requires a == Rumor || b == Rumor || c == Rumor
  ensures Weaker(Weaker(a, b), c) == Rumor
{}
