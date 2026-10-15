// composeSuggestions in src/ts/process/vietjiDict.ts: a chip for the Vietnamese at the end of the input is
// head' + word (+ " " + rest), where head' is the text before the Vietnamese with its trailing spaces dropped only after a
// Chinese/Japanese character. Reported bug: picking 该 for "我 nên" left 该, the 我 gone (the chip replaced the whole input).
// Proved: whatever the head, every non-space character of it is still there, in order, at the start of the new input.
// Run: dafny verify docs/specs/Compose.dfy

function TrimEnd(s: string): string
  decreases |s|
{
  if |s| > 0 && s[|s| - 1] == ' ' then TrimEnd(s[..|s| - 1]) else s
}

function NoSpaces(s: string): string
  decreases |s|
{
  if |s| == 0 then "" else (if s[|s| - 1] == ' ' then NoSpaces(s[..|s| - 1]) else NoSpaces(s[..|s| - 1]) + [s[|s| - 1]])
}

function Compose(head: string, word: string, rest: string, cjkBefore: bool): string
{
  (if cjkBefore then TrimEnd(head) else head) + word + (if rest == "" then "" else " " + rest)
}

lemma TrimEndKeepsLetters(s: string)
  ensures NoSpaces(TrimEnd(s)) == NoSpaces(s)
  ensures |TrimEnd(s)| <= |s| && TrimEnd(s) == s[..|TrimEnd(s)|]
  decreases |s|
{
  if |s| > 0 && s[|s| - 1] == ' ' {
    TrimEndKeepsLetters(s[..|s| - 1]);
    assert s[..|s| - 1][..|TrimEnd(s)|] == s[..|TrimEnd(s)|];
  }
}

lemma HeadKept(head: string, word: string, rest: string, cjkBefore: bool)
  ensures var h := (if cjkBefore then TrimEnd(head) else head);
          Compose(head, word, rest, cjkBefore)[..|h|] == h && NoSpaces(h) == NoSpaces(head)
{
  TrimEndKeepsLetters(head);
}
