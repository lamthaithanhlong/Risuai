// chatDraft.ts draftKey(chaId, chatId), 2026-10-22: two different chats never get one storage key, for ANY ids.
// The key is PREFIX + enc(chaId) + ":" + enc(chatId). enc stands for encodeURIComponent, cut down to the two characters that matter
// here: ':' (the separator) and '%' (the escape itself) become "%3A" and "%25", every other character stays. What the proof uses of it:
// ':' never appears in enc's output, and enc is one-to-one (encodeURIComponent is: it decodes back).
// NaiveCollides shows why the encoding is there: plain concatenation gives ("a:b", "c") and ("a", "b:c") the same key.
// Run: dafny verify DraftKey.dfy

const PREFIX: seq<char> := "risu-draft:"

function EncC(c: char): seq<char> {
  if c == ':' then "%3A" else if c == '%' then "%25" else [c]
}

function Enc(s: seq<char>): seq<char> {
  if |s| == 0 then [] else EncC(s[0]) + Enc(s[1..])
}

datatype Key = None | Some(k: seq<char>)

// draftKey: no key without a character or a chat id
function DraftKey(chaId: seq<char>, chatId: seq<char>): Key {
  if |chaId| == 0 || |chatId| == 0 then None else Some(PREFIX + Enc(chaId) + [':'] + Enc(chatId))
}

function NaiveKey(chaId: seq<char>, chatId: seq<char>): seq<char> { PREFIX + chaId + [':'] + chatId }

lemma EncNoColon(s: seq<char>)
  ensures ':' !in Enc(s)
{
  if |s| > 0 { EncNoColon(s[1..]); assert Enc(s) == EncC(s[0]) + Enc(s[1..]); }
}

// one character's code is never a prefix of another's: the first character, then the second, tell them apart
lemma EncCPrefixFree(x: char, y: char, a: seq<char>, b: seq<char>)
  requires EncC(x) + a == EncC(y) + b
  ensures x == y && a == b
{
  var l := EncC(x) + a;
  var r := EncC(y) + b;
  assert l[0] == r[0];
  if x == ':' || x == '%' {
    assert l[0] == '%';
    assert y == ':' || y == '%';
    assert l[1] == r[1];
    assert x == y;
  } else {
    assert l[0] == x;
    assert y != ':' && y != '%';
    assert x == y;
  }
  assert |EncC(x)| == |EncC(y)|;
  assert a == l[|EncC(x)|..] == r[|EncC(y)|..] == b;
}

lemma EncInjective(s: seq<char>, t: seq<char>)
  requires Enc(s) == Enc(t)
  ensures s == t
  decreases |s|
{
  if |s| == 0 {
    if |t| > 0 { assert |Enc(t)| >= 1; }
  } else {
    if |t| == 0 { assert |Enc(s)| >= 1; }
    assert EncC(s[0]) + Enc(s[1..]) == EncC(t[0]) + Enc(t[1..]);
    EncCPrefixFree(s[0], t[0], Enc(s[1..]), Enc(t[1..]));
    EncInjective(s[1..], t[1..]);
    assert s == [s[0]] + s[1..];
    assert t == [t[0]] + t[1..];
  }
}

// X ":" Y splits at its first ':' when X has none
lemma SplitAtColon(x: seq<char>, y: seq<char>, x2: seq<char>, y2: seq<char>)
  requires ':' !in x && ':' !in x2
  requires x + [':'] + y == x2 + [':'] + y2
  ensures x == x2 && y == y2
{
  var s := x + [':'] + y;
  if |x| < |x2| { assert s[|x|] == ':'; assert s[|x|] == x2[|x|]; assert false; }
  if |x2| < |x| { assert s[|x2|] == ':'; assert s[|x2|] == x[|x2|]; assert false; }
  assert x == s[..|x|] == x2;
  assert y == s[|x| + 1..] == y2;
}

lemma KeyInjective(a: seq<char>, b: seq<char>, c: seq<char>, d: seq<char>)
  requires DraftKey(a, b).Some? && DraftKey(a, b) == DraftKey(c, d)
  ensures a == c && b == d
{
  EncNoColon(a); EncNoColon(c);
  var ka := PREFIX + Enc(a) + [':'] + Enc(b);
  var kc := PREFIX + Enc(c) + [':'] + Enc(d);
  assert ka == kc;
  assert ka[|PREFIX|..] == Enc(a) + [':'] + Enc(b);
  assert kc[|PREFIX|..] == Enc(c) + [':'] + Enc(d);
  SplitAtColon(Enc(a), Enc(b), Enc(c), Enc(d));
  EncInjective(a, c);
  EncInjective(b, d);
}

// two different chats (a different character or a different chat id) never share a draft
lemma DistinctChatsDistinctKeys(a: seq<char>, b: seq<char>, c: seq<char>, d: seq<char>)
  requires DraftKey(a, b).Some? && DraftKey(c, d).Some?
  requires a != c || b != d
  ensures DraftKey(a, b) != DraftKey(c, d)
{
  if DraftKey(a, b) == DraftKey(c, d) { KeyInjective(a, b, c, d); }
}

// the key the old code would have built by plain concatenation is not one-to-one
lemma NaiveCollides()
  ensures NaiveKey("a:b", "c") == NaiveKey("a", "b:c")
{
}
