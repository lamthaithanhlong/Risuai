// The server-owned turn (server/node/turnQueue.cjs, src/ts/process/turnApply.ts), in Dafny.
//
// A. The worker writes a turn into the chat by message id: the input (the turn key's user message) once, then the reply once.
//    A run that died after the save and is run again (same key, the lease ran out) finds both and changes nothing; messages that
//    arrived from elsewhere in the meantime (the Mac) are never dropped or reordered.
// B. A run that starts again takes away only its own earlier partial reply (by id), never what other turns or pages wrote. The
//    page-owned turn did `chat.message.slice(0, previousLength)` (pendingGenerationCore.ts planResume): TurnApplyOld.dfy shows
//    Dafny rejecting that lemma.
// C. The page follows a turn's events by sequence number (GET /api/turns/:key/events?from=N); connections drop at any point and
//    each reconnect replays from the cursor: every event is delivered once, in order, and the page's view is a prefix of the log.
//
// Run: dafny verify TurnApply.dfy

datatype Msg = Msg(id: nat, user: bool)

predicate Has(c: seq<Msg>, id: nat) { exists j :: 0 <= j < |c| && c[j].id == id }
function Count(c: seq<Msg>, id: nat): nat { if |c| == 0 then 0 else (if c[|c|-1].id == id then 1 else 0) + Count(c[..|c|-1], id) }
predicate Unique(c: seq<Msg>) { forall i, j :: 0 <= i < j < |c| ==> c[i].id != c[j].id }

function AppendOnce(c: seq<Msg>, m: Msg): seq<Msg> { if Has(c, m.id) then c else c + [m] }

// ---------------------------------------------------------------- A. applying a turn
function ApplyTurn(c: seq<Msg>, u: Msg, r: Msg): seq<Msg> { AppendOnce(AppendOnce(c, u), r) }

lemma AppendOnceKeeps(c: seq<Msg>, m: Msg)
  ensures |c| <= |AppendOnce(c, m)| && AppendOnce(c, m)[..|c|] == c
  ensures Has(AppendOnce(c, m), m.id)
  ensures Unique(c) ==> Unique(AppendOnce(c, m))
  ensures forall id :: Has(c, id) ==> Has(AppendOnce(c, m), id)
{
  if !Has(c, m.id) {
    var d := c + [m];
    assert d[|c|] == m;
    forall i, j | 0 <= i < j < |d| && Unique(c) ensures d[i].id != d[j].id {
      if j == |c| { assert !(c[i].id == m.id); }
    }
  }
}

lemma AppendOnceIdempotent(c: seq<Msg>, m: Msg)
  ensures AppendOnce(AppendOnce(c, m), m) == AppendOnce(c, m)
{ AppendOnceKeeps(c, m); }

// a run again after the save changes nothing
lemma ApplyTwiceIsOnce(c: seq<Msg>, u: Msg, r: Msg)
  ensures ApplyTurn(ApplyTurn(c, u, r), u, r) == ApplyTurn(c, u, r)
{
  var a := AppendOnce(c, u);
  AppendOnceKeeps(c, u);
  AppendOnceKeeps(a, r);
  var b := AppendOnce(a, r);
  assert Has(b, u.id);
  assert AppendOnce(b, u) == b;
  AppendOnceIdempotent(a, r);
}

// what was in the chat stays, first and in its order; the input and the reply are each there once, the reply after the input
lemma ApplyKeepsAndAddsOnce(c: seq<Msg>, u: Msg, r: Msg)
  requires Unique(c) && u.id != r.id && !Has(c, r.id)
  ensures var d := ApplyTurn(c, u, r);
          Unique(d) && d[..|c|] == c && Has(d, u.id) && Has(d, r.id) && d[|d|-1] == r
          && (exists i :: 0 <= i < |d| - 1 && d[i].id == u.id)
{
  AppendOnceKeeps(c, u);
  var a := AppendOnce(c, u);
  AppendOnceKeeps(a, r);
  assert !Has(a, r.id);
  var d := a + [r];
  assert d[..|c|] == a[..|c|];
  var i :| 0 <= i < |a| && a[i].id == u.id;
  assert d[i].id == u.id;
}

// ---------------------------------------------------------------- B. a run that starts again
// drop the run's own partial reply (its id), keep everything else in order
function DropId(c: seq<Msg>, id: nat): seq<Msg> { if |c| == 0 then [] else DropId(c[..|c|-1], id) + (if c[|c|-1].id == id then [] else [c[|c|-1]]) }

lemma DropKeepsOthers(c: seq<Msg>, id: nat)
  ensures forall x :: Has(c, x) && x != id ==> Has(DropId(c, id), x)
  ensures !Has(DropId(c, id), id)
  ensures forall x :: Has(DropId(c, id), x) ==> Has(c, x)
{
  if |c| > 0 {
    var p := c[..|c|-1];
    DropKeepsOthers(p, id);
    var dp := DropId(p, id);
    var tail := if c[|c|-1].id == id then [] else [c[|c|-1]];
    assert DropId(c, id) == dp + tail;
    forall x | Has(c, x) && x != id ensures Has(DropId(c, id), x) {
      var j :| 0 <= j < |c| && c[j].id == x;
      if j < |c| - 1 {
        assert p[j].id == x; assert Has(p, x); assert Has(dp, x);
        var k :| 0 <= k < |dp| && dp[k].id == x;
        assert (dp + tail)[k] == dp[k];
      } else {
        assert tail == [c[|c|-1]];
        assert (dp + tail)[|dp|].id == x;
      }
    }
    forall x | Has(DropId(c, id), x) ensures Has(c, x) {
      var k :| 0 <= k < |dp + tail| && (dp + tail)[k].id == x;
      if k < |dp| {
        assert dp[k].id == x; assert Has(dp, x); assert Has(p, x);
        var j :| 0 <= j < |p| && p[j].id == x;
        assert c[j].id == x;
      } else {
        assert c[|c|-1].id == x;
      }
    }
    if Has(DropId(c, id), id) {
      var k :| 0 <= k < |dp + tail| && (dp + tail)[k].id == id;
      if k < |dp| { assert dp[k].id == id; assert Has(dp, id); }
    }
  }
}

// ---------------------------------------------------------------- C. following the events by sequence number
// The log holds events 1..|log|; a connection from cursor `next` gets log[next-1..k] for some k (it may drop at any point).
// The page delivers an event only when its seq is the cursor, and moves the cursor on.
function Deliver(log: seq<int>, next: nat, got: seq<int>, upto: nat): (nat, seq<int>)
  requires 1 <= next && next - 1 <= upto <= |log|
  ensures Deliver(log, next, got, upto).0 == upto + 1
  decreases upto - (next - 1)
{
  if next - 1 == upto then (next, got) else Deliver(log, next + 1, got + [log[next - 1]], upto)
}

lemma DeliverIsPrefix(log: seq<int>, next: nat, got: seq<int>, upto: nat)
  requires 1 <= next && next - 1 <= upto <= |log| && got == log[..next - 1]
  ensures Deliver(log, next, got, upto).0 == upto + 1 && Deliver(log, next, got, upto).1 == log[..upto]
  decreases upto - (next - 1)
{
  if next - 1 < upto {
    assert log[..next] == log[..next - 1] + [log[next - 1]];
    DeliverIsPrefix(log, next + 1, got + [log[next - 1]], upto);
  }
}

// any number of connections, each dropped anywhere: the page has exactly the log up to where it got, never a gap or a repeat
lemma ReconnectsNeverLoseOrRepeat(log: seq<int>, cuts: seq<nat>)
  requires forall i :: 0 <= i < |cuts| ==> cuts[i] <= |log|
  requires forall i, j :: 0 <= i < j < |cuts| ==> cuts[i] <= cuts[j]
  ensures var r := Follow(log, 1, [], cuts); r.1 == log[..r.0 - 1]
{ FollowInv(log, 1, [], cuts); }

function Follow(log: seq<int>, next: nat, got: seq<int>, cuts: seq<nat>): (nat, seq<int>)
  requires 1 <= next && next - 1 <= |log|
  requires forall i :: 0 <= i < |cuts| ==> cuts[i] <= |log|
  ensures 1 <= Follow(log, next, got, cuts).0 <= |log| + 1
  decreases |cuts|
{
  if |cuts| == 0 then (next, got)
  else if cuts[0] < next - 1 then Follow(log, next, got, cuts[1..])          // a connection that brought nothing new
  else var d := Deliver(log, next, got, cuts[0]); Follow(log, d.0, d.1, cuts[1..])
}

lemma FollowInv(log: seq<int>, next: nat, got: seq<int>, cuts: seq<nat>)
  requires 1 <= next && next - 1 <= |log| && got == log[..next - 1]
  requires forall i :: 0 <= i < |cuts| ==> cuts[i] <= |log|
  ensures var r := Follow(log, next, got, cuts); 1 <= r.0 && r.1 == log[..r.0 - 1]
  decreases |cuts|
{
  if |cuts| > 0 {
    if cuts[0] >= next - 1 {
      DeliverIsPrefix(log, next, got, cuts[0]);
      var d := Deliver(log, next, got, cuts[0]);
      FollowInv(log, d.0, d.1, cuts[1..]);
    } else { FollowInv(log, next, got, cuts[1..]); }
  }
}

// ---------------------------------------------------------------- D. the chat a turn writes is found by its id
// (turnWorkerPage.ts: chats.findIndex(c => c.id === spec.chatId)). New Chat puts the new chat first (unshift); the id still finds
// the turn's chat. The page's resume note used the index (chatPage): TurnApplyOld.dfy shows that answering another chat.
datatype Chat = Chat(id: nat, msgs: seq<Msg>)

function FindById(cs: seq<Chat>, id: nat): int
  ensures -1 <= FindById(cs, id) < |cs|
  ensures FindById(cs, id) >= 0 ==> cs[FindById(cs, id)].id == id
  ensures FindById(cs, id) == -1 ==> forall j :: 0 <= j < |cs| ==> cs[j].id != id
{
  if |cs| == 0 then -1 else if cs[0].id == id then 0 else (var k := FindById(cs[1..], id); if k == -1 then -1 else k + 1)
}

lemma NewChatKeepsTheTurnsChat(cs: seq<Chat>, n: Chat, id: nat)
  requires n.id != id
  ensures var k := FindById([n] + cs, id); k >= 0 ==> ([n] + cs)[k].id == id
  ensures (exists j :: 0 <= j < |cs| && cs[j].id == id) ==> FindById([n] + cs, id) >= 1
{
  if exists j :: 0 <= j < |cs| && cs[j].id == id {
    var j :| 0 <= j < |cs| && cs[j].id == id;
    assert ([n] + cs)[j + 1].id == id;
  }
}

// ---------------------------------------------------------------- E. a run that did not save leaves nothing after its input
// (turnWorkerPage.ts: on failure the chat is cut after the turn's input before the save; specs/turns TurnQueue CutOnFail). TLC found
// the turn failed for good with the words of a cut stream left in the chat when this was missing.
function IndexOf(c: seq<Msg>, id: nat): int
  ensures -1 <= IndexOf(c, id) < |c|
  ensures IndexOf(c, id) >= 0 ==> c[IndexOf(c, id)].id == id
  ensures IndexOf(c, id) == -1 ==> !Has(c, id)
{
  if |c| == 0 then -1 else (var k := IndexOf(c[..|c|-1], id); if k >= 0 then k else if c[|c|-1].id == id then |c| - 1 else -1)
}

function CutAfterInput(c: seq<Msg>, inputId: nat): seq<Msg>
{
  var k := IndexOf(c, inputId); if k < 0 then c else c[..k + 1]
}

lemma CutLeavesNoReply(c: seq<Msg>, inputId: nat, replyId: nat)
  requires Unique(c) && replyId != inputId
  requires Has(c, inputId) && Has(c, replyId)
  // the reply came after the input (the worker appends it)
  requires forall i, j :: 0 <= i < |c| && 0 <= j < |c| && c[i].id == inputId && c[j].id == replyId ==> i < j
  ensures !Has(CutAfterInput(c, inputId), replyId)
  ensures CutAfterInput(c, inputId)[..IndexOf(c, inputId)] == c[..IndexOf(c, inputId)]   // everything before the input stays
  ensures Has(CutAfterInput(c, inputId), inputId)
{
  var k := IndexOf(c, inputId);
  var d := c[..k + 1];
  assert d[k].id == inputId;
  if Has(d, replyId) {
    var j :| 0 <= j < |d| && d[j].id == replyId;
    assert c[j].id == replyId;
    assert j <= k;
    assert j != k;
  }
}
