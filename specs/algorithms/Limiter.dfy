// Dafny (Z3 inside) models of createLimiter and retryDelayMs.
//
//   createLimiter  src/ts/translator/limiter.ts
//   retryDelayMs   src/ts/storage/writeRetry.ts
//   empty-reply retry  src/lib/ChatScreens/DefaultChatScreen.svelte (sendChatMain) + src/ts/process/emptyReply.ts
//
// dafny verify Limiter.dfy      -> 0 errors (the fixed limiter, the retry bounds)
// dafny verify LimiterOld.dfy   -> exactly 1 error, by design: the old limiter (release gave the slot back, the waiter took it a
//                                  microtask later). Measured in TypeScript: 2 tasks at max 1, src/ts/translator/limiter.race.test.ts.

// ---------------------------------------------------------------- the fixed limiter

datatype Lim = Lim(running: int, waiting: int)

ghost predicate Valid(s: Lim, max: int)
{
  max >= 1 && 0 <= s.running <= max && s.waiting >= 0
  // work-conserving: nobody waits while a slot is free
  && (s.waiting > 0 ==> s.running == max)
}

// run(): take a slot if one is free, otherwise queue
function Arrive(s: Lim, max: int): Lim
{
  if s.running >= max then Lim(s.running, s.waiting + 1) else Lim(s.running + 1, s.waiting)
}

// release(): the slot goes straight to the next waiter, or is freed
function Finish(s: Lim): Lim
  requires s.running >= 1
{
  if s.waiting > 0 then Lim(s.running, s.waiting - 1) else Lim(s.running - 1, 0)
}

lemma ArrivePreserves(s: Lim, max: int)
  requires Valid(s, max)
  ensures Valid(Arrive(s, max), max)
{
}

lemma FinishPreserves(s: Lim, max: int)
  requires Valid(s, max) && s.running >= 1
  ensures Valid(Finish(s), max)
{
}

// Everything that waits is eventually run: each Finish with a waiter moves one waiter into a running slot.
lemma FinishServesAWaiter(s: Lim, max: int)
  requires Valid(s, max) && s.running >= 1 && s.waiting > 0
  ensures Finish(s).waiting == s.waiting - 1 && Finish(s).running == s.running
{
}

// ---------------------------------------------------------------- write retry delay

// status codes as a small enum; hdr = the Retry-After seconds, 0 when absent or not a positive number
datatype Kind = Rate429 | Lost | Other

function min(a: int, b: int): int { if a < b then a else b }

function pow2(n: nat): int { if n == 0 then 1 else 2 * pow2(n - 1) }

const WriteMaxAttempts: int := 6

// -1 stands for null (do not retry)
function retryDelay(k: Kind, attempt: nat, hdr: int): int
{
  if attempt + 1 >= WriteMaxAttempts then -1
  else match k
    case Rate429 =>
      if hdr > 0 then min(hdr, 70) * 1000 + 250 else min(pow2(attempt), 30) * 1000
    case Lost => min(500 * pow2(attempt), 5000)
    case Other => -1
}

lemma RetryStops(k: Kind, attempt: nat, hdr: int)
  requires attempt >= WriteMaxAttempts - 1
  ensures retryDelay(k, attempt, hdr) == -1
{
}

lemma RetryDelayBounds(k: Kind, attempt: nat, hdr: int)
  requires retryDelay(k, attempt, hdr) != -1
  ensures 250 < retryDelay(k, attempt, hdr) <= 70250
{
  assert attempt <= 4;
  if k.Rate429? && hdr <= 0 {
    assert pow2(attempt) >= 1;
  }
  if k.Lost? {
    assert pow2(attempt) >= 1;
  }
}

// Without a server header the wait grows with the attempt (so it backs off), for both retryable kinds.
lemma BackoffGrows(k: Kind, a: nat)
  requires k != Other && a + 2 < WriteMaxAttempts
  ensures retryDelay(k, a, 0) <= retryDelay(k, a + 1, 0)
{
  assert pow2(a + 1) == 2 * pow2(a);
}

// The whole retry budget is bounded: at most 5 retries, each at most 70.25 s.
lemma TotalWaitBounded(k: Kind, hdr: int)
  ensures forall a: nat :: a < WriteMaxAttempts - 1 && retryDelay(k, a, hdr) != -1 ==> retryDelay(k, a, hdr) <= 70250
{
  forall a: nat | a < WriteMaxAttempts - 1 && retryDelay(k, a, hdr) != -1
    ensures retryDelay(k, a, hdr) <= 70250
  {
    RetryDelayBounds(k, a, hdr);
  }
}

// ---------------------------------------------------------------- empty-reply retry

const MaxEmptyRetries: int := 2

// sendChatMain recurses with retriesDone + 1 while the reply is empty and retriesDone < MaxEmptyRetries
method EmptyReplyCalls(alwaysEmpty: bool) returns (calls: nat)
  ensures calls <= MaxEmptyRetries + 1
  ensures alwaysEmpty ==> calls == MaxEmptyRetries + 1
  ensures !alwaysEmpty ==> calls == 1
{
  calls := 1;
  var retriesDone := 0;
  while alwaysEmpty && retriesDone < MaxEmptyRetries
    invariant 0 <= retriesDone <= MaxEmptyRetries
    invariant calls == retriesDone + 1
    invariant !alwaysEmpty ==> retriesDone == 0
    decreases MaxEmptyRetries - retriesDone
  {
    retriesDone := retriesDone + 1;
    calls := calls + 1;
  }
}
