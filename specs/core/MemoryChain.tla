---------------------------- MODULE MemoryChain ----------------------------
(* HypaV3 (hypav3.ts hypaMemoryV3Main). Summaries are a chain: each one covers a run of messages (its chatMemos). The context is
   the summaries plus the raw messages from startIdx on, where startIdx is the position after the LAST message of the LAST summary.
   Everything before startIdx is assumed to be covered by the summaries.
   cleanOrphanedSummary drops a summary when ANY of its messages was deleted (default, preserveOrphanedMemory = false).
   Clean = "all"  : the shipped default, drops every summary that has a deleted message.
   Clean = "none" : preserveOrphanedMemory.
   Clean = "tail" : the fix, drops orphaned summaries only from the end of the chain, so the chain never has a hole.
   Safety NoLoss: every message still in the chat is in the context, raw or through a kept summary. *)
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS MaxId, Clean
VARIABLES chat,        \* the messages in order, as a sequence of ids
          sums,        \* the summary chain: a sequence of sets of message ids
          nextId

vars == <<chat, sums, nextId>>

Init == chat = <<>> /\ sums = <<>> /\ nextId = 1

Members(s) == s                                \* a summary is the set of ids it covers
IdsOf(c) == {c[i] : i \in 1..Len(c)}
Covered == UNION {sums[i] : i \in 1..Len(sums)}

\* index (1-based) of id in the chat, 0 if absent
IndexOf(c, id) == IF \E i \in 1..Len(c) : c[i] = id
                  THEN CHOOSE i \in 1..Len(c) : c[i] = id ELSE 0

\* highest id a summary covers (the "last chatMemo")
MaxOf(s) == CHOOSE x \in s : \A y \in s : y <= x

StartIdx == IF Len(sums) = 0 THEN 0
            ELSE LET li == IndexOf(chat, MaxOf(sums[Len(sums)])) IN IF li = 0 THEN 0 ELSE li   \* messages before index li+1 are skipped

\* what the model receives: the summaries, and the raw messages after startIdx (all of them when no last message is found)
RawIds == {chat[i] : i \in (StartIdx + 1)..Len(chat)}
InContext == Covered \cup RawIds

AddMsg == /\ nextId <= MaxId /\ chat' = Append(chat, nextId) /\ nextId' = nextId + 1 /\ UNCHANGED sums
Delete(i) == /\ i \in 1..Len(chat)
             /\ chat' = SubSeq(chat, 1, i - 1) \o SubSeq(chat, i + 1, Len(chat))
             /\ UNCHANGED <<sums, nextId>>

AllPresent(s) == s \subseteq IdsOf(chat)

\* generate step: first the orphan cleanup, then (when long enough) summarize the run after startIdx, keeping the newest message raw
RECURSIVE TrimTail(_)
TrimTail(q) == IF Len(q) > 0 /\ ~AllPresent(q[Len(q)]) THEN TrimTail(SubSeq(q, 1, Len(q) - 1)) ELSE q

CleanStep == /\ Clean # "none"
             /\ LET kept == IF Clean = "all" THEN SelectSeq(sums, AllPresent) ELSE TrimTail(sums)
                IN kept # sums /\ sums' = kept
             /\ UNCHANGED <<chat, nextId>>
Summarize == /\ Len(chat) - StartIdx >= 2
             /\ \E k \in (StartIdx + 1)..(Len(chat) - 1) :
                  sums' = Append(sums, {chat[j] : j \in (StartIdx + 1)..k})
             /\ UNCHANGED <<chat, nextId>>

Next == AddMsg \/ (\E i \in 1..Len(chat) : Delete(i)) \/ CleanStep \/ Summarize
Spec == Init /\ [][Next]_vars

NoLoss == IdsOf(chat) \subseteq InContext
=============================================================================
