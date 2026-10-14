// Server-Sent Events framing as a fold over characters (chars are ints, 10 is the line feed). eventsource-parser, which the app uses,
// follows the same rules for the part that matters here: a line is complete at a line feed, an event is complete at an empty line,
// and what comes in between is kept for the next chunk. Simplified: only "data:" lines count, and "\r" is not modelled.
//
// What is proved is what makes streaming safe: where the network happens to cut the stream never changes what was received, an
// event is never produced early or twice, and what has been produced only grows.

datatype St = St(line: seq<int>, data: seq<seq<int>>, events: seq<seq<int>>)

const LF: int := 10
const D: int := 100  // d
const A: int := 97   // a
const T: int := 116  // t
const COLON: int := 58
const SPACE: int := 32

predicate IsDataLine(l: seq<int>) { |l| >= 5 && l[..5] == [D, A, T, A, COLON] }

function Payload(l: seq<int>): seq<int>
  requires IsDataLine(l)
{
  if |l| > 5 && l[5] == SPACE then l[6..] else l[5..]
}

function Join(lines: seq<seq<int>>): seq<int>
  decreases |lines|
{
  if |lines| == 0 then [] else if |lines| == 1 then lines[0] else Join(lines[..|lines|-1]) + [LF] + lines[|lines|-1]
}

function Step(st: St, c: int): St
{
  if c != LF then St(st.line + [c], st.data, st.events)
  else if |st.line| == 0 then
    // an empty line ends the event, if it had data
    (if |st.data| > 0 then St([], [], st.events + [Join(st.data)]) else st)
  else if IsDataLine(st.line) then St([], st.data + [Payload(st.line)], st.events)
  else St([], st.data, st.events)   // a comment or another field: dropped
}

function Feed(st: St, s: seq<int>): St
  decreases |s|
{
  if |s| == 0 then st else Feed(Step(st, s[0]), s[1..])
}

function FeedAll(st: St, chunks: seq<seq<int>>): St
  decreases |chunks|
{
  if |chunks| == 0 then st else FeedAll(Feed(st, chunks[0]), chunks[1..])
}

function Concat(chunks: seq<seq<int>>): seq<int>
  decreases |chunks|
{
  if |chunks| == 0 then [] else chunks[0] + Concat(chunks[1..])
}

lemma FeedAppend(st: St, a: seq<int>, b: seq<int>)
  ensures Feed(st, a + b) == Feed(Feed(st, a), b)
  decreases |a|
{
  if |a| == 0 {
    assert a + b == b;
  } else {
    assert (a + b)[0] == a[0];
    assert (a + b)[1..] == a[1..] + b;
    FeedAppend(Step(st, a[0]), a[1..], b);
  }
}

// CHUNK INVARIANCE: feeding the stream in any pieces gives exactly what feeding it whole gives.
lemma ChunkInvariance(st: St, chunks: seq<seq<int>>)
  ensures FeedAll(st, chunks) == Feed(st, Concat(chunks))
  decreases |chunks|
{
  if |chunks| > 0 {
    ChunkInvariance(Feed(st, chunks[0]), chunks[1..]);
    FeedAppend(st, chunks[0], Concat(chunks[1..]));
  }
}

predicate IsPrefix<T(==)>(a: seq<T>, b: seq<T>) { |a| <= |b| && b[..|a|] == a }

lemma StepGrows(st: St, c: int)
  ensures IsPrefix(st.events, Step(st, c).events)
{}

lemma FeedGrows(st: St, s: seq<int>)
  ensures IsPrefix(st.events, Feed(st, s).events)
  decreases |s|
{
  if |s| > 0 {
    StepGrows(st, s[0]);
    FeedGrows(Step(st, s[0]), s[1..]);
  }
}

// NOTHING EARLY, NOTHING TWICE: an event is added only by the empty line that ends it, and then all its data lines go with it.
lemma EventOnlyAtBlankLine(st: St, c: int)
  ensures |Step(st, c).events| > |st.events| ==> (c == LF && |st.line| == 0 && |st.data| > 0)
  ensures |Step(st, c).events| > |st.events| ==> Step(st, c).events == st.events + [Join(st.data)] && Step(st, c).data == []
  ensures |Step(st, c).events| == |st.events| ==> Step(st, c).events == st.events
{}

// What has been received is a prefix of what will be: the events so far never change and only grow when more arrives.
lemma ReceivedIsPrefix(st: St, received: seq<int>, rest: seq<int>)
  ensures IsPrefix(Feed(st, received).events, Feed(st, received + rest).events)
{
  FeedAppend(st, received, rest);
  FeedGrows(Feed(st, received), rest);
}

// A data line cut in two by the network is not an event until its empty line arrives: nothing is emitted for a half line.
lemma HalfLineEmitsNothing(st: St, s: seq<int>)
  requires forall i :: 0 <= i < |s| ==> s[i] != LF
  ensures Feed(st, s).events == st.events
  decreases |s|
{
  if |s| > 0 {
    assert Step(st, s[0]).events == st.events;
    assert forall i :: 0 <= i < |s[1..]| ==> s[1..][i] != LF;
    HalfLineEmitsNothing(Step(st, s[0]), s[1..]);
  }
}
