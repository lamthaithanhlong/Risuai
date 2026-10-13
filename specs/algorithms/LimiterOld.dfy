// The limiter as it was before the fix. This file is EXPECTED TO FAIL verification: the failing lemma is the bug.
// release(): running-- and wake one waiter; the woken waiter does running++ a microtask later. A call that arrives in
// between sees a free slot and takes it, so one more task than `max` runs. Fixed in src/ts/translator/limiter.ts.


// release(): running--, wake one waiter; the waiter does running++ later (a separate step, `pending` = woken, not yet counted)
datatype L = L(running: int, waiting: int, pending: int)

ghost predicate ValidOld(s: L, max: int)
{
  max >= 1 && 0 <= s.running <= max && s.waiting >= 0 && s.pending >= 0
  && s.running + s.pending <= max
}

function Arrive(s: L, max: int): L
{
  if s.running >= max then L(s.running, s.waiting + 1, s.pending) else L(s.running + 1, s.waiting, s.pending)
}

function Release(s: L): L
  requires s.running >= 1
{
  if s.waiting > 0 then L(s.running - 1, s.waiting - 1, s.pending + 1) else L(s.running - 1, s.waiting, s.pending)
}

function Wake(s: L): L
  requires s.pending >= 1
{
  L(s.running + 1, s.waiting, s.pending - 1)
}

// Release frees a slot (running--) and wakes a waiter that has not yet counted itself (pending++): the two together still fit.
lemma ReleasePreservesOld(s: L, max: int)
  requires ValidOld(s, max) && s.running >= 1
  ensures ValidOld(Release(s), max)
{
}

lemma WakePreservesOld(s: L, max: int)
  requires ValidOld(s, max) && s.pending >= 1
  ensures ValidOld(Wake(s), max)
{
}

// THE BUG: a new call that arrives while a woken waiter is still pending sees a free slot (running < max) and takes it,
// so running + pending is now above max. This lemma does NOT verify (Dafny / Z3 cannot prove it: it is false).
lemma ArrivePreservesOld(s: L, max: int)
  requires ValidOld(s, max)
  ensures ValidOld(Arrive(s, max), max)
{
}
