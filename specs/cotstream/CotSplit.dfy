// The splitter that takes the chain of thought out of a reply, as a left fold over the tokens (src/ts/parser/cot.ts is the
// implementation; this is the part of it that makes live streaming safe). Chars are ints. Open/Close are the thought tags.
// Simplifications, all listed in cot.ts: nested tags count as depth only (they are dropped from the text), no half-tag hold-back,
// no "reasoning</think>" implicit opening. What is proved holds for every input, so also for a reply cut anywhere.

datatype Tok = Open | Close | Ch(c: int)

datatype St = St(depth: nat, main: seq<int>, thought: seq<int>)

function Step(st: St, t: Tok): St
{
  match t
  case Open => St(st.depth + 1, st.main, st.thought)
  case Close => if st.depth > 0 then St(st.depth - 1, st.main, st.thought) else st   // a stray closing tag is dropped
  case Ch(c) => if st.depth > 0 then St(st.depth, st.main, st.thought + [c])
                else St(st.depth, st.main + [c], st.thought)
}

function Run(st: St, s: seq<Tok>): St
  decreases |s|
{
  if |s| == 0 then st else Run(Step(st, s[0]), s[1..])
}

function Split(s: seq<Tok>): St { Run(St(0, [], []), s) }

function CharCount(s: seq<Tok>): nat
{
  if |s| == 0 then 0 else (if s[0].Ch? then 1 else 0) + CharCount(s[1..])
}

predicate IsPrefix<T(==)>(a: seq<T>, b: seq<T>) { |a| <= |b| && b[..|a|] == a }

lemma StepGrows(st: St, t: Tok)
  ensures IsPrefix(st.main, Step(st, t).main) && IsPrefix(st.thought, Step(st, t).thought)
{}

lemma RunGrows(st: St, s: seq<Tok>)
  ensures IsPrefix(st.main, Run(st, s).main) && IsPrefix(st.thought, Run(st, s).thought)
  decreases |s|
{
  if |s| > 0 {
    StepGrows(st, s[0]);
    RunGrows(Step(st, s[0]), s[1..]);
  }
}

lemma RunAppend(st: St, a: seq<Tok>, b: seq<Tok>)
  ensures Run(st, a + b) == Run(Run(st, a), b)
  decreases |a|
{
  if |a| == 0 {
    assert a + b == b;
  } else {
    assert (a + b)[0] == a[0];
    assert (a + b)[1..] == a[1..] + b;
    RunAppend(Step(st, a[0]), a[1..], b);
    assert Run(st, a) == Run(Step(st, a[0]), a[1..]);
    assert Run(st, a + b) == Run(Step(st, a[0]), a[1..] + b);
  }
}

// STREAMING: whatever has been received is a prefix of what will be received, so what the chat shows and what the panel shows
// only ever grow. Nothing already drawn is taken back.
lemma StreamMonotone(prefix: seq<Tok>, rest: seq<Tok>)
  ensures IsPrefix(Split(prefix).main, Split(prefix + rest).main)
  ensures IsPrefix(Split(prefix).thought, Split(prefix + rest).thought)
{
  RunAppend(St(0, [], []), prefix, rest);
  RunGrows(Split(prefix), rest);
}

// NOTHING IS LOST: every character ends up in the chat or in the panel, none in both and none dropped.
lemma RunCountsChars(st: St, s: seq<Tok>)
  ensures |Run(st, s).main| + |Run(st, s).thought| == |st.main| + |st.thought| + CharCount(s)
  decreases |s|
{
  if |s| > 0 { RunCountsChars(Step(st, s[0]), s[1..]); }
}

lemma NothingLost(s: seq<Tok>)
  ensures |Split(s).main| + |Split(s).thought| == CharCount(s)
{ RunCountsChars(St(0, [], []), s); }

function NoTags(s: seq<int>): seq<Tok> { seq(|s|, i requires 0 <= i < |s| => Ch(s[i])) }

lemma RunAllChars(st: St, s: seq<int>)
  ensures Run(st, NoTags(s)).depth == st.depth
  ensures st.depth == 0 ==> Run(st, NoTags(s)).main == st.main + s && Run(st, NoTags(s)).thought == st.thought
  ensures st.depth > 0 ==> Run(st, NoTags(s)).thought == st.thought + s && Run(st, NoTags(s)).main == st.main
  decreases |s|
{
  if |s| > 0 {
    assert NoTags(s)[1..] == NoTags(s[1..]);
    RunAllChars(Step(st, Ch(s[0])), s[1..]);
    assert (st.main + [s[0]]) + s[1..] == st.main + s;
    assert (st.thought + [s[0]]) + s[1..] == st.thought + s;
  }
}

// THE SHAPE A MODEL PRODUCES: <Thoughts> thought </Thoughts> reply, or the same cut anywhere.
// While thinking (no closing tag yet) the whole text so far is the thought and the chat is empty.
lemma WhileThinking(th: seq<int>)
  ensures Split([Open] + NoTags(th)).main == [] && Split([Open] + NoTags(th)).thought == th && Split([Open] + NoTags(th)).depth == 1
{
  var t := [Open] + NoTags(th);
  assert t[0] == Open;
  assert t[1..] == NoTags(th);
  assert Step(St(0, [], []), Open) == St(1, [], []);
  assert Split(t) == Run(St(1, [], []), NoTags(th));
  RunAllChars(St(1, [], []), th);
}

// Once the thought is closed, the chat shows exactly the reply received so far and the panel shows exactly the thought.
lemma WhileReplying(th: seq<int>, rp: seq<int>)
  ensures Split([Open] + NoTags(th) + [Close] + NoTags(rp)).main == rp
  ensures Split([Open] + NoTags(th) + [Close] + NoTags(rp)).thought == th
  ensures Split([Open] + NoTags(th) + [Close] + NoTags(rp)).depth == 0
{
  var a := [Open] + NoTags(th) + [Close];
  var mid := Split([Open] + NoTags(th));
  WhileThinking(th);
  assert a == ([Open] + NoTags(th)) + [Close];
  RunAppend(St(0, [], []), [Open] + NoTags(th), [Close]);
  assert Run(mid, [Close]) == Step(mid, Close);
  RunAppend(St(0, [], []), a, NoTags(rp));
  RunAllChars(Step(mid, Close), rp);
  assert [Open] + NoTags(th) + [Close] + NoTags(rp) == a + NoTags(rp);
}

// THE CHAT PARSER SEES THE REPLY ONLY: the main text does not depend on the thought at all.
lemma MainIgnoresThought(th1: seq<int>, th2: seq<int>, rp: seq<int>)
  ensures Split([Open] + NoTags(th1) + [Close] + NoTags(rp)).main == Split([Open] + NoTags(th2) + [Close] + NoTags(rp)).main
{
  WhileReplying(th1, rp);
  WhileReplying(th2, rp);
}

// NESTING: a tag inside a thought does not end it. "<T> a <T> b </T> c </T> d": a b c is the thought, only d is the reply.
lemma NestedBlock()
  ensures Split([Open, Ch(1), Open, Ch(2), Close, Ch(3), Close, Ch(4)]).thought == [1, 2, 3]
  ensures Split([Open, Ch(1), Open, Ch(2), Close, Ch(3), Close, Ch(4)]).main == [4]
{}
