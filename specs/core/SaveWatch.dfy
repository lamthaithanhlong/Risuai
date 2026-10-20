// The autosave's change watch (src/ts/storage/saveWatch.svelte.ts).
//
// A. readDeep: the stack walk that replaced $state.snapshot. Reading a value is what subscribes an effect to it, so a walk that
//    skipped any object or array under the root would lose the changes made there. Proved: the loop ends, and the objects and
//    arrays it visits are exactly those under the root (a typed array or class instance is a leaf it does not enter).
//    Values are trees here (the database is JSON); the `seen` set of the TypeScript only matters for a shared or cyclic object,
//    which a tree does not have.
// B. Which effect reads what. Every part of the database the encoder writes for the selected character or the root is read by
//    some effect, and that effect reports the block that holds it (no lost change); the card effect reads nothing under `chats`
//    (a message never re-walks the card, the cost the fix is for); the chats effect reads all chats, not just the open one.
// C. The trigger runs (scriptings.ts runLuaEditTrigger, triggers.ts runTrigger) take copies: the card's stored triggers are the same
//    after a run. The old code set lowLevelAccess on the stored ones, false in one path and the card's own flag in the other,
//    so a card with lowLevelAccess changed on every rendered chunk (258 card walks in one played turn, measured).

// ---------- A ----------
datatype Val = Leaf | Opaque | Node(kids: seq<Val>)

function Prefix(p: seq<nat>, S: set<seq<nat>>): set<seq<nat>> { set q | q in S :: p + q }

// the paths of the objects and arrays under v (v itself is [])
function Paths(v: Val): set<seq<nat>>
  decreases v, if v.Node? then |v.kids| + 1 else 0
{
  if v.Node? then {[]} + ChildPaths(v, |v.kids|) else {}
}

function ChildPaths(v: Val, i: nat): set<seq<nat>>
  requires v.Node? && i <= |v.kids|
  decreases v, i
{
  if i == 0 then {} else ChildPaths(v, i - 1) + Prefix([i - 1], Paths(v.kids[i - 1]))
}

function Under(p: seq<nat>, v: Val): set<seq<nat>> { Prefix(p, Paths(v)) }

function StackPaths(st: seq<(seq<nat>, Val)>): set<seq<nat>>
{
  if |st| == 0 then {} else StackPaths(st[..|st| - 1]) + Under(st[|st| - 1].0, st[|st| - 1].1)
}

function KidsUnder(p: seq<nat>, k: seq<Val>, i: nat): set<seq<nat>>
  requires i <= |k|
{
  if i == 0 then {} else KidsUnder(p, k, i - 1) + Under(p + [i - 1], k[i - 1])
}

function Size(v: Val): nat
  decreases v, if v.Node? then |v.kids| + 1 else 0
{
  if v.Node? then 1 + SizeSum(v, |v.kids|) else 1
}

function SizeSum(v: Val, i: nat): nat
  requires v.Node? && i <= |v.kids|
  decreases v, i
{
  if i == 0 then 0 else SizeSum(v, i - 1) + Size(v.kids[i - 1])
}

function StackSize(st: seq<(seq<nat>, Val)>): nat
{
  if |st| == 0 then 0 else StackSize(st[..|st| - 1]) + Size(st[|st| - 1].1)
}

lemma PrefixEmpty(S: set<seq<nat>>)
  ensures Prefix([], S) == S
{
  forall q | q in S ensures q in Prefix([], S) { assert [] + q == q; }
  forall x | x in Prefix([], S) ensures x in S { var q :| q in S && x == [] + q; assert [] + q == q; }
}

lemma PrefixAssoc(p: seq<nat>, a: seq<nat>, S: set<seq<nat>>)
  ensures Prefix(p, Prefix(a, S)) == Prefix(p + a, S)
{
  forall x | x in Prefix(p, Prefix(a, S)) ensures x in Prefix(p + a, S) {
    var y :| y in Prefix(a, S) && x == p + y;
    var q :| q in S && y == a + q;
    assert x == (p + a) + q;
  }
  forall x | x in Prefix(p + a, S) ensures x in Prefix(p, Prefix(a, S)) {
    var q :| q in S && x == (p + a) + q;
    assert a + q in Prefix(a, S);
    assert x == p + (a + q);
  }
}

lemma PrefixUnion(p: seq<nat>, A: set<seq<nat>>, B: set<seq<nat>>)
  ensures Prefix(p, A + B) == Prefix(p, A) + Prefix(p, B)
{}

lemma KidsPrefix(p: seq<nat>, v: Val, i: nat)
  requires v.Node? && i <= |v.kids|
  ensures Prefix(p, ChildPaths(v, i)) == KidsUnder(p, v.kids, i)
{
  if i > 0 {
    KidsPrefix(p, v, i - 1);
    PrefixUnion(p, ChildPaths(v, i - 1), Prefix([i - 1], Paths(v.kids[i - 1])));
    PrefixAssoc(p, [i - 1], Paths(v.kids[i - 1]));
  }
}

lemma UnderNode(p: seq<nat>, v: Val)
  requires v.Node?
  ensures Under(p, v) == {p} + KidsUnder(p, v.kids, |v.kids|)
{
  PrefixUnion(p, {[]}, ChildPaths(v, |v.kids|));
  assert Prefix(p, {[]}) == {p} by { assert p + [] == p; }
  KidsPrefix(p, v, |v.kids|);
}

lemma StackPush(st: seq<(seq<nat>, Val)>, e: (seq<nat>, Val))
  ensures StackPaths(st + [e]) == StackPaths(st) + Under(e.0, e.1)
  ensures StackSize(st + [e]) == StackSize(st) + Size(e.1)
{
  assert (st + [e])[..|st + [e]| - 1] == st;
}

// the TypeScript: stack = [value]; pop; skip a leaf or a non-plain object; visit; push every child
method ReadDeep(v: Val) returns (visited: set<seq<nat>>)
  ensures visited == Paths(v)
{
  visited := {};
  var st: seq<(seq<nat>, Val)> := [([], v)];
  assert StackPaths(st) == StackPaths([]) + Under([], v);
  PrefixEmpty(Paths(v));
  while |st| > 0
    invariant visited + StackPaths(st) == Paths(v)
    decreases StackSize(st)
  {
    var last := st[|st| - 1];
    var rest := st[..|st| - 1];
    assert StackPaths(st) == StackPaths(rest) + Under(last.0, last.1);
    assert StackSize(st) == StackSize(rest) + Size(last.1);
    var p := last.0;
    var w := last.1;
    if w.Node? {
      UnderNode(p, w);
      visited := visited + {p};
      var i := 0;
      st := rest;
      while i < |w.kids|
        invariant 0 <= i <= |w.kids|
        invariant StackPaths(st) == StackPaths(rest) + KidsUnder(p, w.kids, i)
        invariant StackSize(st) == StackSize(rest) + SizeSum(w, i)
      {
        StackPush(st, (p + [i], w.kids[i]));
        st := st + [(p + [i], w.kids[i])];
        i := i + 1;
      }
    } else {
      assert Under(p, w) == {};
      st := rest;
    }
  }
}

// ---------- B ----------
// A part of the database the encoder writes: a root key, or a field of the selected character (its card fields and `chats`).
datatype Part = Root(key: string) | Card(field: string) | ChatOf(index: nat)
datatype Effect = RootEffect | CardEffect | ChatsEffect | ListEffect(name: string)
datatype Block = RootBlock | CharacterBlock | OwnBlock(name: string)

const OwnBlocks: set<string> := {"characters", "botPresets", "modules", "loadouts", "plugins", "pluginCustomStorage"}

// what each effect reads (streaming: only the flag of the open chat, so no ChatOf part)
predicate Reads(e: Effect, x: Part, streaming: bool, openOnly: bool, open: nat)
{
  match e
  case RootEffect => x.Root? && x.key !in OwnBlocks
  case ListEffect(n) => x.Root? && x.key == n && n in OwnBlocks - {"characters", "botPresets"}
  case CardEffect => x.Card? && x.field != "chats"
  case ChatsEffect => x.ChatOf? && !streaming && (!openOnly || x.index == open)
}

// what an effect run reports, as the block the save re-encodes
function Reports(e: Effect): Block
{
  match e
  case RootEffect => RootBlock
  case CardEffect => CharacterBlock
  case ChatsEffect => CharacterBlock
  case ListEffect(n) => OwnBlock(n)
}

function BlockOf(x: Part): Block
{
  match x
  case Root(k) => if k in OwnBlocks then OwnBlock(k) else RootBlock
  case Card(_) => CharacterBlock
  case ChatOf(_) => CharacterBlock
}

// a part the encoder writes for the root or the selected character (characters are their own blocks; botPresets is watched by
// its id and length, as before the change, and is not part of this lemma)
predicate Written(x: Part) { (x.Root? && x.key != "characters" && x.key != "botPresets") || (x.Card? && x.field != "chats") || x.ChatOf? }

lemma NoLostChange(x: Part, open: nat)
  requires Written(x)
  ensures exists e: Effect :: Reads(e, x, false, false, open) && Reports(e) == BlockOf(x)
{
  match x
  case Root(k) =>
    if k in OwnBlocks { assert Reads(ListEffect(k), x, false, false, open); }
    else { assert Reads(RootEffect, x, false, false, open); }
  case Card(f) => assert Reads(CardEffect, x, false, false, open);
  case ChatOf(i) => assert Reads(ChatsEffect, x, false, false, open);
}

// the card effect reads no chat: a message never re-runs the walk of the card
lemma CardNeverReadsChats(x: Part, streaming: bool, open: nat)
  requires x.ChatOf?
  ensures !Reads(CardEffect, x, streaming, false, open)
{}

// the cheaper "open chat only" split loses a reply that lands in another chat (chatSlot.ts)
lemma OpenOnlyLosesOtherChat(open: nat, e: Effect)
  ensures !Reads(e, ChatOf(open + 1), false, true, open)
{}

// ---------- C ----------
datatype Trigger = Trigger(code: string, lowLevelAccess: bool)

// the old runLuaEditTrigger map: `v.lowLevelAccess = false; return v`, writing into the stored list; runTrigger wrote the card's flag
function OldRunLua(stored: seq<Trigger>): seq<Trigger> { seq(|stored|, i requires 0 <= i < |stored| => stored[i].(lowLevelAccess := false)) }
function OldRunTrigger(stored: seq<Trigger>, flag: bool): seq<Trigger> { seq(|stored|, i requires 0 <= i < |stored| => stored[i].(lowLevelAccess := flag)) }

// with a card whose lowLevelAccess is on, every display render after a trigger run changes the stored card
lemma OldFlips(stored: seq<Trigger>)
  requires |stored| > 0
  ensures OldRunLua(OldRunTrigger(stored, true)) != OldRunTrigger(stored, true)
{
  assert OldRunLua(OldRunTrigger(stored, true))[0].lowLevelAccess != OldRunTrigger(stored, true)[0].lowLevelAccess;
}

// the fix: the runs work on copies (`{...v, lowLevelAccess}`); the stored list is what it was, so nothing re-runs
method NewRunLua(stored: seq<Trigger>) returns (run: seq<Trigger>, after: seq<Trigger>)
  ensures after == stored
  ensures |run| == |stored| && forall i :: 0 <= i < |run| ==> run[i] == stored[i].(lowLevelAccess := false)
{
  run := seq(|stored|, i requires 0 <= i < |stored| => stored[i].(lowLevelAccess := false));
  after := stored;
}
