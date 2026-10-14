// HypaV3 summarization loop (hypav3.ts hypaMemoryV3Main, "while (summarizationMode)"), token accounting and termination.
// t[i] is the token count of chat i. cur is currentTokens. Each round drops chats [s, end) from the raw context, where
// end = min(s + m, n - q), subtracts their tokens, and sets s = end. m = maxChatsPerSummary, q = queryChatCount.
// Proved: with m >= 1 the loop always ends, every round makes progress, the newest q chats are never dropped, and cur always equals
// the start value minus the tokens of exactly the chats dropped so far.

function SumRange(t: seq<int>, a: int, b: int): int
  requires 0 <= a <= b <= |t|
  decreases b - a
{ if a == b then 0 else t[a] + SumRange(t, a + 1, b) }

lemma SumRangeSplit(t: seq<int>, a: int, mid: int, b: int)
  requires 0 <= a <= mid <= b <= |t|
  ensures SumRange(t, a, b) == SumRange(t, a, mid) + SumRange(t, mid, b)
  decreases mid - a
{ if a < mid { SumRangeSplit(t, a + 1, mid, b); } }

method SummarizeRounds(t: seq<int>, q: int, m: int, start: int, cur0: int, target: int, maxCtx: int)
  returns (s: int, cur: int, rounds: int)
  requires q >= 1 && m >= 1                        // the validation the code lacks: the UI has min=1, nothing checks a loaded preset
  requires 0 <= start <= |t| - q
  requires forall i :: 0 <= i < |t| ==> t[i] >= 0
  ensures start <= s <= |t| - q                    // the newest q chats stay raw
  ensures cur == cur0 - SumRange(t, start, s)     // the books balance with the dropped chats, nothing else
{
  s := start;
  cur := cur0;
  rounds := 0;
  while cur > target && |t| - s > q
    invariant start <= s <= |t| - q
    invariant cur == cur0 - SumRange(t, start, s)
    decreases |t| - q - s
  {
    var end := if s + m < |t| - q then s + m else |t| - q;
    assert end > s;                                // progress needs m >= 1 and |t| - s > q
    SumRangeSplit(t, start, s, end);
    cur := cur - SumRange(t, s, end);
    s := end;
    rounds := rounds + 1;
  }
}
