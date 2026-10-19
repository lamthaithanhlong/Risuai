---- MODULE DbSync ----
\* server/node/dbSync.cjs as it decides how to store a page's write of database.bin (the merge itself is MergeSave/Merge3).
\* What MergeSave.tla does not have and this adds:
\*  - the server knows a page by its SIGNING KEY (server.cjs clientIdOf = req.risuClient), and two tabs of one browser share the key
\*    (it lives in IndexedDB, util.ts getKeypairStore). Id(t) maps a tab to the identity the server sees.
\*  - one base row per identity (sync_client), overwritten by every read of that identity.
\*  - the fast path: no row in sync_write after the base from ANOTHER identity -> the bytes are stored as they are.
\*  - pruning on read: manifests and write rows older than rev - KEEP are deleted; a write whose base manifest is gone is stored as is.
\* Fix flags: PerTab (the server sees one id per tab), PinBases (never prune a revision some identity still has as its base),
\* LoadedBase (F7: a tab that loads a backup instead of the file it read tells the server, which then merges its writes against the
\* backup; dbSync.cjs onLoaded). Backups = TRUE adds that step (bootstrap.ts falls back to a dbbackup when database.bin does not decode):
\* the server has recorded the base at the read, but the tab holds an OLDER revision. _BACKUP (LoadedBase = FALSE) is red.
\* The code since F3/F4 is PerTab = TRUE, PinBases = TRUE (DbSync_FIXED.cfg, green); _SAMEBROWSER and _PRUNED are the code before
\* (d588ddef) and stay red; _PERTABONLY / _PINONLY show each fix covers its own case.
EXTENDS Naturals, FiniteSets

CONSTANTS Tabs, Keys, MaxRev, MaxEdits, KEEP, SameBrowser, PerTab, PinBases, Backups, LoadedBase

Id(t) == IF PerTab THEN t ELSE IF SameBrowser THEN "browser" ELSE t
Ids == {Id(t) : t \in Tabs}
NoBase == 0

VARIABLES server, rev, hist, writer, local, tabRev, loaded, base, floor, edits, forced
vars == <<server, rev, hist, writer, local, tabRev, loaded, base, floor, edits, forced>>

Zero == [k \in Keys |-> 0]
Init == /\ server = Zero /\ rev = 1 /\ hist = [r \in 1..MaxRev |-> Zero] /\ writer = [r \in 1..MaxRev |-> "none"]
        /\ local = [t \in Tabs |-> Zero] /\ tabRev = [t \in Tabs |-> 1] /\ loaded = [t \in Tabs |-> FALSE]
        /\ base = [i \in Ids |-> NoBase] /\ floor = 1 /\ edits = 0 /\ forced = [i \in Ids |-> FALSE]

MinBase == LET bs == {base[i] : i \in {j \in Ids : base[j] # NoBase}} IN IF bs = {} THEN rev ELSE CHOOSE m \in bs : \A x \in bs : m <= x
\* onRead: the tab gets the current file; its identity's base becomes rev; old manifests and write rows are pruned
Read(t) == /\ local' = [local EXCEPT ![t] = server] /\ tabRev' = [tabRev EXCEPT ![t] = rev] /\ loaded' = [loaded EXCEPT ![t] = TRUE]
           /\ base' = [base EXCEPT ![Id(t)] = rev] /\ forced' = [forced EXCEPT ![Id(t)] = FALSE]
           /\ floor' = IF rev > KEEP THEN (IF PinBases THEN (IF rev - KEEP < MinBase THEN rev - KEEP ELSE MinBase) ELSE rev - KEEP) ELSE floor
           /\ UNCHANGED <<server, rev, hist, writer, edits>>
\* the read registers base = rev, then the tab decodes a backup: it HOLDS revision r < rev. With LoadedBase the server is told, the base
\* becomes what it holds (a manifest kept apart, never pruned while referenced) and its writes are always merged.
ReadBackup(t, r) == /\ Backups /\ r < rev
           /\ local' = [local EXCEPT ![t] = hist[r]] /\ tabRev' = [tabRev EXCEPT ![t] = r] /\ loaded' = [loaded EXCEPT ![t] = TRUE]
           /\ base' = [base EXCEPT ![Id(t)] = IF LoadedBase THEN r ELSE rev] /\ forced' = [forced EXCEPT ![Id(t)] = LoadedBase]
           /\ UNCHANGED <<server, rev, hist, writer, edits, floor>>
Edit(t, k) == /\ loaded[t] /\ edits < MaxEdits /\ edits' = edits + 1 /\ local' = [local EXCEPT ![t][k] = edits + 1]
              /\ UNCHANGED <<server, rev, hist, writer, tabRev, loaded, base, floor, forced>>

\* the three-way merge by key against the base revision (what Merge3.dfy proves)
Merged(t, b) == [k \in Keys |-> IF local[t][k] = hist[b][k] THEN server[k] ELSE local[t][k]]
Foreign(i, b) == \E r \in (b + 1)..rev : r >= floor /\ writer[r] # i
Write(t) == /\ loaded[t] /\ rev < MaxRev
            /\ LET i == Id(t)
                   b == base[i]
                   how == IF b = NoBase THEN "unknown" ELSE IF forced[i] THEN "merged" ELSE IF ~Foreign(i, b) THEN "fast" ELSE IF b < floor THEN "pruned" ELSE "merged"
                   new == IF how = "merged" THEN Merged(t, b) ELSE local[t]
               IN /\ server' = new /\ rev' = rev + 1 /\ hist' = [hist EXCEPT ![rev + 1] = new] /\ writer' = [writer EXCEPT ![rev + 1] = i]
                  /\ base' = IF how \in {"unknown", "pruned"} THEN [base EXCEPT ![i] = rev + 1] ELSE base
            /\ UNCHANGED <<local, tabRev, loaded, floor, edits, forced>>

Next == \E t \in Tabs : Read(t) \/ Write(t) \/ (\E k \in Keys : Edit(t, k)) \/ (\E r \in 1..MaxRev : ReadBackup(t, r))
Spec == Init /\ [][Next]_vars

\* a key the writing tab did not change (against what IT loaded) keeps the server's value: nobody's acknowledged edit is overwritten
NoLostUpdate == [][ \A t \in Tabs : Write(t) => \A k \in Keys : (local[t][k] = hist[tabRev[t]][k]) => server'[k] = server[k] ]_vars
\* and the writer's own edit is stored
OwnEditKept == [][ \A t \in Tabs : Write(t) => \A k \in Keys : (local[t][k] # hist[tabRev[t]][k]) => server'[k] = local[t][k] ]_vars
====
