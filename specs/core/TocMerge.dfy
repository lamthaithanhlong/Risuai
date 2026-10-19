// historyIndexPage.ts: a TOC job writes the lines of the messages that were missing when it started. Since the fix the job
// outlives the turn (helperJob.ts), so its answer may land after another turn's job already wrote lines. What must hold:
//   Keep    every line the chat already had is still there (a late job never deletes a summary),
//   Cover   a missing message the answer has a line for now has one,
//   Shrink  what is still missing after the merge is a subset of what was missing before (progress: each old message is
//           summarised once, so turns stop resending the whole history to a ChatGPT web turn).
// Break it on purpose (merge into an empty map instead of toc, or require n in answer for messages not missing) and Dafny rejects it.

function Merge(toc: map<int, string>, missing: set<int>, answer: map<int, string>): map<int, string>
{
  map k | k in toc.Keys + (missing * answer.Keys) :: if k in missing && k in answer then answer[k] else toc[k]
}

function Missing(olds: set<int>, toc: map<int, string>): set<int>
{
  set k | k in olds && k !in toc
}

lemma Keep(toc: map<int, string>, missing: set<int>, answer: map<int, string>)
  ensures toc.Keys <= Merge(toc, missing, answer).Keys
{}

lemma Cover(toc: map<int, string>, missing: set<int>, answer: map<int, string>)
  ensures forall k :: k in missing && k in answer ==> k in Merge(toc, missing, answer) && Merge(toc, missing, answer)[k] == answer[k]
{}

lemma Shrink(olds: set<int>, toc: map<int, string>, answer: map<int, string>)
  ensures Missing(olds, Merge(toc, Missing(olds, toc), answer)) <= Missing(olds, toc)
  ensures Missing(olds, Merge(toc, Missing(olds, toc), answer)) == Missing(olds, toc) - answer.Keys
{}
