// Three pieces of Risu's "generate message" path, proved in Dafny (SMT: Z3).
//  A. the lorebook scan window (lorebook.svelte.ts searchMatch)        -- the shipped formula is wrong, the fix is right
//  B. the lore token budget cut (loadLoreBookV3Prompt)                  -- the card fix: always-on entries are kept
//  C. the context truncation loop (index.svelte.ts, while currentTokens > maxContextTokens) -- keeps the newest message

// ---------------------------------------------------------------- A. scan window
function Min(a: int, b: int): int { if a < b then a else b }
function Max(a: int, b: int): int { if a > b then a else b }

// JavaScript Array.prototype.slice(start): a negative start counts from the end, clamped to 0
function JsSlice<T>(s: seq<T>, start: int): seq<T> {
  if start >= 0 then s[Min(start, |s|)..] else s[Max(|s| + start, 0)..]
}

// shipped: messages.slice(messages.length - depth, messages.length)
function OldWindow<T>(s: seq<T>, depth: int): seq<T> { JsSlice(s, |s| - depth) }
// fix: lastItems()
function NewWindow<T>(s: seq<T>, depth: int): seq<T> {
  if depth <= 0 then [] else s[Max(0, |s| - depth)..]
}

// the fix returns exactly the last min(depth, length) items, in order
lemma NewWindowCorrect<T>(s: seq<T>, depth: int)
  requires depth >= 0
  ensures |NewWindow(s, depth)| == Min(depth, |s|)
  ensures NewWindow(s, depth) == s[|s| - Min(depth, |s|)..]
{ }

// the shipped formula agrees with it only when the chat is at least as long as the depth ...
lemma OldWindowRightWhenLongEnough<T>(s: seq<T>, depth: int)
  requires 0 < depth <= |s|
  ensures OldWindow(s, depth) == NewWindow(s, depth)
{ }

// ... and loses messages otherwise: 4 messages at depth 5 give 1, 8 at depth 12 give 4 (found by reading, confirmed here)
lemma OldWindowLosesMessages()
  ensures |OldWindow([1, 2, 3, 4], 5)| == 1 && |NewWindow([1, 2, 3, 4], 5)| == 4
  ensures |OldWindow([1, 2, 3, 4, 5, 6, 7, 8], 12)| == 4 && |NewWindow([1, 2, 3, 4, 5, 6, 7, 8], 12)| == 8
{ }

// ---------------------------------------------------------------- B. lore token budget
function TokSum(toks: seq<int>): int { if |toks| == 0 then 0 else toks[0] + TokSum(toks[1..]) }

lemma TokSumPrefix(toks: seq<int>, i: int)
  requires 0 <= i < |toks|
  ensures TokSum(toks[..i+1]) == TokSum(toks[..i]) + toks[i]
{
  if i == 0 { } else {
    assert toks[..i+1][1..] == toks[1..][..i];
    assert toks[..i][1..] == toks[1..][..i-1];
    TokSumPrefix(toks[1..], i - 1);
  }
}

// activated entries arrive already sorted by priority, highest first; keep one while the running total fits the budget
method SelectLore(toks: seq<int>, budget: int, constants: int) returns (keep: seq<bool>)
  requires forall i :: 0 <= i < |toks| ==> toks[i] >= 0
  requires 0 <= constants <= |toks|
  // the always-on entries are the first `constants` in priority order and fit the budget together
  requires TokSum(toks[..constants]) <= budget
  ensures |keep| == |toks|
  // 1. the kept entries never exceed the budget
  ensures TokSum(KeptTokens(toks, keep)) <= budget
  // 2. every always-on entry is kept, whatever follows (the card fix: priority above keyed lore, budget with room)
  ensures forall i :: 0 <= i < constants ==> keep[i]
{
  keep := [];
  var used := 0;
  var i := 0;
  PrefixMonotone(toks, 0, constants);   // so 0 <= budget
  assert toks[..0] == [];
  while i < |toks|
    invariant 0 <= i <= |toks| && |keep| == i
    invariant used == TokSum(KeptTokens(toks[..i], keep))
    invariant used <= budget
    invariant forall j :: 0 <= j < i && j < constants ==> keep[j]
    invariant i <= constants ==> used == TokSum(toks[..i])
  {
    TokSumPrefix(toks, i);
    if i < constants { ConstantsPrefixBound(toks, i, constants, budget); }
    var fits := used + toks[i] <= budget;
    if i < constants { assert fits; }
    ghost var prev := KeptTokens(toks[..i], keep);
    KeptTokensStep(toks, keep, i, fits);
    if fits { TokSumAppendOne(prev, toks[i]); }
    keep := keep + [fits];
    if fits { used := used + toks[i]; }
    assert KeptTokens(toks[..i+1], keep) == prev + (if fits then [toks[i]] else []);
    if !fits { assert prev + [] == prev; }
    i := i + 1;
  }
  assert toks[..i] == toks;
}

lemma TokSumAppendOne(a: seq<int>, x: int)
  ensures TokSum(a + [x]) == TokSum(a) + x
{
  if |a| == 0 { assert a + [x] == [x]; } else {
    assert (a + [x])[1..] == a[1..] + [x];
    TokSumAppendOne(a[1..], x);
  }
}

function KeptTokens(toks: seq<int>, keep: seq<bool>): seq<int>
  requires |toks| == |keep|
{
  if |toks| == 0 then [] else (if keep[0] then [toks[0]] else []) + KeptTokens(toks[1..], keep[1..])
}

lemma KeptTokensStep(toks: seq<int>, keep: seq<bool>, i: int, k: bool)
  requires 0 <= i < |toks| && |keep| == i
  ensures KeptTokens(toks[..i+1], keep + [k]) == KeptTokens(toks[..i], keep) + (if k then [toks[i]] else [])
{
  if i == 0 { } else {
    assert toks[..i+1][1..] == toks[1..][..i];
    assert toks[..i][1..] == toks[1..][..i-1];
    assert (keep + [k])[1..] == keep[1..] + [k];
    KeptTokensStep(toks[1..], keep[1..], i - 1, k);
  }
}

lemma ConstantsPrefixBound(toks: seq<int>, i: int, constants: int, budget: int)
  requires forall j :: 0 <= j < |toks| ==> toks[j] >= 0
  requires 0 <= i < constants <= |toks|
  requires TokSum(toks[..constants]) <= budget
  ensures TokSum(toks[..i+1]) <= budget
{
  // the sum of a prefix of non-negative numbers is at most the sum of the longer prefix
  PrefixMonotone(toks, i + 1, constants);
}

lemma PrefixMonotone(toks: seq<int>, a: int, b: int)
  requires forall j :: 0 <= j < |toks| ==> toks[j] >= 0
  requires 0 <= a <= b <= |toks|
  ensures TokSum(toks[..a]) <= TokSum(toks[..b])
  decreases b - a
{
  if a < b {
    TokSumPrefix(toks, b - 1);
    PrefixMonotone(toks, a, b - 1);
  }
}

// ---------------------------------------------------------------- C. context truncation
// chats are oldest first; fixed is everything that is not chat history (description, lore, persona, max response, +50).
// Loop of index.svelte.ts: while the total exceeds the context, drop the oldest; with one message left it is an error.
method Truncate(chats: seq<int>, fixed: int, maxCtx: int) returns (kept: seq<int>, fits: bool, dropped: int)
  requires |chats| >= 1
  requires forall i :: 0 <= i < |chats| ==> chats[i] >= 0
  ensures 0 <= dropped < |chats|
  ensures kept == chats[dropped..]
  // the newest message is never dropped, so the user's input always goes out
  ensures |kept| >= 1 && kept[|kept| - 1] == chats[|chats| - 1]
  // success means it fits; failure (the "too much token" error) means even the newest message alone does not
  ensures fits ==> fixed + TokSum(kept) <= maxCtx
  ensures !fits ==> |kept| == 1 && fixed + TokSum(kept) > maxCtx
  // no over-trimming: if one more message had been kept, it would not have fit
  ensures dropped > 0 ==> fixed + TokSum(chats[dropped - 1..]) > maxCtx
{
  dropped := 0;
  while dropped < |chats| - 1 && fixed + TokSum(chats[dropped..]) > maxCtx
    invariant 0 <= dropped <= |chats| - 1
    invariant dropped > 0 ==> fixed + TokSum(chats[dropped - 1..]) > maxCtx
  {
    dropped := dropped + 1;
  }
  kept := chats[dropped..];
  fits := fixed + TokSum(kept) <= maxCtx;
}
