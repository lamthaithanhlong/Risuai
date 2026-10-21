---- MODULE RemoteSync ----
\* One remotes/<chaId>.local.bin: a character with ALL its chats, written whole by every page through /api/write (risuSave.ts
\* encodeRemoteBlock) when enableRemoteSaving is on (the live save, measured 2026-10-20). database.bin only holds a pointer to it, so
\* dbMerge.cjs / dbSync.cjs (specs/chat/DbSync.tla) never saw a chat: two pages, or a page and the Async turn worker (turnWorker.cjs),
\* wrote the file last-writer-wins and the first reply was erased by a later page write (tests/turns/repro.mjs --scenarios double --trace).
\* A message is the unit (a chat's messages are merged by chatId, dbMerge.cjs mergeById); the file is the set of messages it holds.
\*  - Mode "lww": the write replaces the file (the code until this change).
\*  - Mode "merge": the server remembers, per page and per file, the version the page last READ OR WROTE (base). A write is merged
\*    three-way: a message stays when both sides have it, or when one side has it and the base did not (new on that side), and is gone
\*    when it was in the base and either side dropped it. Same rule as MessageMerge.dfy.
\*  - Advance: after a write the base becomes what the page wrote (its memory), as DbSync.tla AdvanceBase. Without it the base stays
\*    the version the page READ, so its own earlier additions look new again and a message another page deleted comes back.
\* NoLostAck: a message a page wrote (the server acknowledged it) and nobody deleted is still in the file.
\* NoResurrect: a message a page deleted and then wrote (acknowledged) is not in the file.
\* _OLD (lww) is red on NoLostAck; _NOADVANCE (merge, base not advanced) is green on NoLostAck and red on NoResurrect; _NEW is green.
EXTENDS Naturals, FiniteSets

CONSTANTS Tabs, Msgs, Mode, Advance

VARIABLES server, local, base, tdel, used, acked, dels, gone
vars == <<server, local, base, tdel, used, acked, dels, gone>>

Init == /\ server = {} /\ local = [t \in Tabs |-> {}] /\ base = [t \in Tabs |-> {}] /\ tdel = [t \in Tabs |-> {}]
        /\ used = {} /\ acked = {} /\ dels = {} /\ gone = {}

\* a page loads the file: that is now its base (server.cjs /api/read -> dbSync.onRemoteRead)
Read(t) == /\ local' = [local EXCEPT ![t] = server] /\ base' = [base EXCEPT ![t] = server] /\ tdel' = [tdel EXCEPT ![t] = {}]
           /\ UNCHANGED <<server, used, acked, dels, gone>>
Add(t, m) == /\ m \notin used /\ used' = used \cup {m} /\ local' = [local EXCEPT ![t] = @ \cup {m}]
             /\ UNCHANGED <<server, base, tdel, acked, dels, gone>>
Delete(t, m) == /\ m \in local[t] /\ local' = [local EXCEPT ![t] = @ \ {m}] /\ tdel' = [tdel EXCEPT ![t] = @ \cup {m}] /\ dels' = dels \cup {m}
                /\ UNCHANGED <<server, base, used, acked, gone>>

\* ours = the page's file, theirs = the server's, b = the page's base
Merge3(ours, theirs, b) == (ours \cap theirs) \cup (ours \ b) \cup (theirs \ b)

\* /api/write (dbSync.onRemoteWrite): the page's file is stored, or merged with the server's
Write(t) == /\ server' = IF Mode = "lww" THEN local[t] ELSE Merge3(local[t], server, base[t])
            /\ base' = IF Advance THEN [base EXCEPT ![t] = local[t]] ELSE base
            /\ acked' = acked \cup local[t] /\ gone' = gone \cup tdel[t]
            /\ UNCHANGED <<local, tdel, used, dels>>

Next == \E t \in Tabs : Read(t) \/ Write(t) \/ (\E m \in Msgs : Add(t, m) \/ Delete(t, m))
Spec == Init /\ [][Next]_vars

NoLostAck == (acked \ dels) \subseteq server
NoResurrect == gone \cap server = {}
====
