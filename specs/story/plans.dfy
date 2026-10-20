// status.lua dropOldPlans, as a model: each message is (isChar, hasPlan). On every reply (onOutput) the loop
//   for i = n - 2, max(0, n - 12), -1: a char message there loses its "[💡Kế hoạch| … ]" line
// The lore pass reads the last W = 12 messages for keys (the cards' scanDepth), so a plan line in that window wakes its names.
datatype Msg = Msg(isChar: bool, hasPlan: bool)
const W := 12

function max(a: int, b: int): int { if a > b then a else b }

// the Lua loop after the fix: i from n-2 down to 0 (every older reply), not only the last 12 messages
method DropOldPlans(c: seq<Msg>) returns (d: seq<Msg>)
  requires |c| >= 1
  ensures |d| == |c|
  ensures d[|c|-1] == c[|c|-1]
  ensures forall i :: 0 <= i < |c|-1 && c[i].isChar ==> !d[i].hasPlan
  ensures forall i :: 0 <= i < |c| ==> d[i].isChar == c[i].isChar
  ensures forall i :: 0 <= i < |c| && !c[i].hasPlan ==> !d[i].hasPlan
{
  d := c;
  var i := |c| - 2;
  while i >= 0
    invariant |d| == |c|
    invariant -1 <= i <= |c| - 2
    invariant d[|c|-1] == c[|c|-1]
    invariant forall j :: i < j < |c|-1 && c[j].isChar ==> !d[j].hasPlan
    invariant forall j :: 0 <= j < |c| ==> d[j].isChar == c[j].isChar
    invariant forall j :: 0 <= j < |c| && !c[j].hasPlan ==> !d[j].hasPlan
    invariant forall j :: (0 <= j <= i || j == |c|-1) ==> d[j] == c[j]
  {
    if d[i].isChar && d[i].hasPlan { d := d[i := Msg(true, false)]; }
    i := i - 1;
  }
}

// no older reply keeps a plan line; then whatever window the lore pass reads, only the newest message can wake names
predicate Clean(c: seq<Msg>) {
  forall i :: 0 <= i < |c|-1 && c[i].isChar ==> !c[i].hasPlan
}

lemma CleanWindow(c: seq<Msg>, w: int)     // the property the lore pass needs, for any scan depth w
  requires Clean(c) && w >= 1
  ensures forall i :: max(0, |c|-w) <= i < |c|-1 && c[i].isChar ==> !c[i].hasPlan
{}

// the operations a chat goes through; Clean holds after each one, from an empty chat
method Reply(c: seq<Msg>, plan: bool) returns (d: seq<Msg>)
  ensures Clean(d) && |d| == |c| + 1 && d[|d|-1] == Msg(true, plan)
{
  d := DropOldPlans(c + [Msg(true, plan)]);
}

lemma UserKeepsClean(c: seq<Msg>)        // the player sends a message: nothing new carries a plan line in a char message
  requires Clean(c) && |c| >= 1 && !(c[|c|-1].isChar && c[|c|-1].hasPlan)
  ensures Clean(c + [Msg(false, false)])
{}

lemma DeleteKeepsClean(c: seq<Msg>)      // a rollback deletes the last message
  requires Clean(c) && |c| >= 2
  ensures Clean(c[..|c|-1])
{}
