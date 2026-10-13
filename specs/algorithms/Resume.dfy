// Dafny models of the small pure algorithms added to Risu for the phone (killed page, retries, repaint pacing, backups).
// Each function mirrors one TypeScript function; the lemmas are the properties the unit tests only sample.
//
//   planResumeWithRestore  src/ts/process/pendingGenerationCore.ts
//   nextFlushDelay         src/ts/process/streamingPace.ts
//   retryAttempts          src/ts/process/retry.ts   (withRetry)
//   shouldWriteBackup      src/ts/storage/saveTracker.ts
//
// Run:  dafny verify Resume.dfy

datatype Role = User | Char

// ---------------------------------------------------------------- resume after a kill

datatype Plan = NoResume | Keep(keep: int, restore: bool)

// -1 stands for null
function planResume(prev: int, roles: seq<Role>): int
{
  if prev < 1 || |roles| < prev then -1
  else if roles[prev - 1] == User then prev
  else -1
}

function planResumeWithRestore(prev: int, roles: seq<Role>, hasUserMessage: bool): Plan
{
  var k := planResume(prev, roles);
  if k != -1 then Keep(k, false)
  else if hasUserMessage && prev >= 1 && |roles| == prev - 1 then Keep(prev, true)
  else NoResume
}

// After applying a plan the chat is `chat`: the kept prefix, or the saved chat plus the restored user message.
function applyPlan(p: Plan, roles: seq<Role>): seq<Role>
  requires p.Keep? && p.keep >= 0
  requires p.restore || p.keep <= |roles|
{
  if p.restore then roles + [User] else roles[..p.keep]
}

lemma ResumeIsSafe(prev: int, roles: seq<Role>, has: bool)
  ensures var p := planResumeWithRestore(prev, roles, has);
          p.Keep? ==>
            // the chat that is regenerated from always ends with the user's message, at exactly the recorded length
            && p.keep == prev
            && (if p.restore then |roles| + 1 == prev && has
                else prev <= |roles| && roles[prev - 1] == User)
{
}

lemma ResumeEndsWithUserMessage(prev: int, roles: seq<Role>, has: bool)
  requires planResumeWithRestore(prev, roles, has).Keep? && planResumeWithRestore(prev, roles, has).keep >= 0
  ensures var p := planResumeWithRestore(prev, roles, has);
          var chat := applyPlan(p, roles);
          |chat| == prev && chat[|chat| - 1] == User
{
}

// A chat that still holds the user's message is resumed without needing the note's copy of it.
lemma SavedChatWinsOverNote(prev: int, roles: seq<Role>, has: bool)
  requires prev >= 1 && |roles| >= prev && roles[prev - 1] == User
  ensures planResumeWithRestore(prev, roles, has) == Keep(prev, false)
{
}

// The note's copy is only used when exactly that one message is missing: a chat that lost more is left alone.
lemma RestoreOnlyWhenExactlyOneShort(prev: int, roles: seq<Role>, has: bool)
  requires |roles| < prev - 1 || prev < 1
  ensures planResumeWithRestore(prev, roles, has) == NoResume
{
}

// ---------------------------------------------------------------- repaint pacing

function nextFlushDelay(base: int, cost: int, max: int): int
  requires 0 <= base <= max
{
  var d := 3 * cost;
  if d < base then base else if d > max then max else d
}

lemma DelayBounded(base: int, cost: int, max: int)
  requires 0 <= base <= max
  ensures base <= nextFlushDelay(base, cost, max) <= max
{
}

lemma DelayMonotone(base: int, c1: int, c2: int, max: int)
  requires 0 <= base <= max && c1 <= c2
  ensures nextFlushDelay(base, c1, max) <= nextFlushDelay(base, c2, max)
{
}

// A cheap repaint never slows the display below the base rate.
lemma CheapRepaintKeepsBase(base: int, cost: int, max: int)
  requires 0 <= base <= max && 3 * cost <= base
  ensures nextFlushDelay(base, cost, max) == base
{
}

// ---------------------------------------------------------------- retry

// How many times `run` is called when it fails `fails` times in a row before it would succeed,
// with `delays` retries allowed. Mirrors withRetry's loop.
method RetryAttempts(delays: seq<int>, fails: nat) returns (calls: nat, succeeded: bool)
  ensures calls <= |delays| + 1
  ensures succeeded <==> fails <= |delays|
  ensures succeeded ==> calls == fails + 1
  ensures !succeeded ==> calls == |delays| + 1
{
  calls := 0;
  succeeded := false;
  while true
    invariant 0 <= calls <= |delays|
    invariant calls <= fails
    invariant !succeeded
    decreases |delays| - calls
  {
    calls := calls + 1;
    if calls > fails {
      succeeded := true;
      return;
    }
    // run() failed; withRetry reads delays[calls - 1] and throws when there is none
    if calls > |delays| {
      return;
    }
  }
}

// ---------------------------------------------------------------- backup throttle

function shouldWriteBackup(last: int, now: int, gap: int): bool
{
  last == 0 || now < last || now - last >= gap
}

// Between two copies at least `gap` passes, unless the clock went backwards (then a copy is always allowed).
lemma BackupsAreSpaced(last: int, now: int, gap: int)
  requires gap > 0 && last != 0
  ensures shouldWriteBackup(last, now, gap) <==> (now < last || now - last >= gap)
  ensures !shouldWriteBackup(last, now, gap) ==> last <= now < last + gap
{
}

lemma FirstSaveAlwaysCopies(now: int, gap: int)
  ensures shouldWriteBackup(0, now, gap)
{
}
