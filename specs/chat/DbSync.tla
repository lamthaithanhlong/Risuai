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
\* AdvanceBase (measured 2026-10-19 with Toxiproxy against a copy of the save, S3c/S3d/S7/S7d): the base of an identity stayed the
\* revision it LOADED, also after its own acknowledged writes, so every later write of that page counted its earlier writes as edits
\* again. Another page's edit or delete of a message this page had written (or a lost ack whose retry arrived after that edit) was
\* undone. NoLostUpdateSinceSync says it: a key the tab did not change since it last read OR wrote keeps the server's value.
\* _SINCESYNC (the code: base stays the loaded rev) is red; _ADVANCE (the base becomes what the page wrote; a merged write forces the
\* next write of that page to merge, since the server then holds more than the page) is green. OwnEditKept (against what the tab
\* LOADED) is exactly the rule AdvanceBase drops, so _ADVANCE checks OwnEditKeptSinceSync instead.
\* AfterMerge (2026-10-20, only with AdvanceBase): what a merged write leaves as the page's base. "loaded" (the code until then): always
\* the page's own file under a negative id, so every later write of that page merges again, forever -- the live log showed "0 parts
\* from the server, 0 both-changed" on every save, ~120-150 ms of the server's event loop each. "ifempty": a merge that took nothing
\* from the server (no key the page left alone and the server changed, no key both changed: the code's report.fromServer,
\* blocksFromServer and conflicts all 0) stores the page's own file and makes that revision its base, so the fast path comes back
\* (_EMPTYPLAIN, green). "always": the same after ANY merge -- the server then holds more than the page and its next fast write
\* would drop that (_ALWAYSPLAIN, red: it shows the "took nothing" guard is what keeps NoLostUpdateSinceSync).
EXTENDS Naturals, FiniteSets

CONSTANTS Tabs, Keys, MaxRev, MaxEdits, KEEP, SameBrowser, PerTab, PinBases, Backups, LoadedBase, AdvanceBase, AfterMerge

Id(t) == IF PerTab THEN t ELSE IF SameBrowser THEN "browser" ELSE t
Ids == {Id(t) : t \in Tabs}
NoBase == 0

\* bst: the state an identity's base stands for (what its next write is merged against); synced: what a tab last read or wrote
VARIABLES server, rev, hist, writer, local, tabRev, loaded, base, floor, edits, forced, bst, synced
vars == <<server, rev, hist, writer, local, tabRev, loaded, base, floor, edits, forced, bst, synced>>

Zero == [k \in Keys |-> 0]
Init == /\ server = Zero /\ rev = 1 /\ hist = [r \in 1..MaxRev |-> Zero] /\ writer = [r \in 1..MaxRev |-> "none"]
        /\ local = [t \in Tabs |-> Zero] /\ tabRev = [t \in Tabs |-> 1] /\ loaded = [t \in Tabs |-> FALSE]
        /\ base = [i \in Ids |-> NoBase] /\ floor = 1 /\ edits = 0 /\ forced = [i \in Ids |-> FALSE]
        /\ bst = [i \in Ids |-> Zero] /\ synced = [t \in Tabs |-> Zero]

MinBase == LET bs == {base[i] : i \in {j \in Ids : base[j] # NoBase}} IN IF bs = {} THEN rev ELSE CHOOSE m \in bs : \A x \in bs : m <= x
\* onRead: the tab gets the current file; its identity's base becomes rev; old manifests and write rows are pruned
Read(t) == /\ local' = [local EXCEPT ![t] = server] /\ tabRev' = [tabRev EXCEPT ![t] = rev] /\ loaded' = [loaded EXCEPT ![t] = TRUE]
           /\ base' = [base EXCEPT ![Id(t)] = rev] /\ forced' = [forced EXCEPT ![Id(t)] = FALSE]
           /\ bst' = [bst EXCEPT ![Id(t)] = server] /\ synced' = [synced EXCEPT ![t] = server]
           /\ floor' = IF rev > KEEP THEN (IF PinBases THEN (IF rev - KEEP < MinBase THEN rev - KEEP ELSE MinBase) ELSE rev - KEEP) ELSE floor
           /\ UNCHANGED <<server, rev, hist, writer, edits>>
\* the read registers base = rev, then the tab decodes a backup: it HOLDS revision r < rev. With LoadedBase the server is told, the base
\* becomes what it holds (a manifest kept apart, never pruned while referenced) and its writes are always merged.
ReadBackup(t, r) == /\ Backups /\ r < rev
           /\ local' = [local EXCEPT ![t] = hist[r]] /\ tabRev' = [tabRev EXCEPT ![t] = r] /\ loaded' = [loaded EXCEPT ![t] = TRUE]
           /\ base' = [base EXCEPT ![Id(t)] = IF LoadedBase THEN r ELSE rev] /\ forced' = [forced EXCEPT ![Id(t)] = LoadedBase]
           /\ bst' = [bst EXCEPT ![Id(t)] = IF LoadedBase THEN hist[r] ELSE server] /\ synced' = [synced EXCEPT ![t] = hist[r]]
           /\ UNCHANGED <<server, rev, hist, writer, edits, floor>>
Edit(t, k) == /\ loaded[t] /\ edits < MaxEdits /\ edits' = edits + 1 /\ local' = [local EXCEPT ![t][k] = edits + 1]
              /\ UNCHANGED <<server, rev, hist, writer, tabRev, loaded, base, floor, forced, bst, synced>>

\* the three-way merge by key against the base (what Merge3.dfy proves); without AdvanceBase bst[i] is always hist[base[i]]
Merged(t, s) == [k \in Keys |-> IF local[t][k] = s[k] THEN server[k] ELSE local[t][k]]
Foreign(i, b) == \E r \in (b + 1)..rev : r >= floor /\ writer[r] # i
\* the merge of t's write against s takes nothing from the server: every key the page left alone is as the server has it, and no key was
\* changed by both to different values (dbMerge.cjs report.fromServer / blocksFromServer / conflicts all 0)
TookNothing(t, s) == \A k \in Keys : (local[t][k] = s[k] => server[k] = s[k]) /\ (local[t][k] # s[k] /\ server[k] # s[k] => server[k] = local[t][k])
Write(t) == /\ loaded[t] /\ rev < MaxRev
            /\ LET i == Id(t)
                   b == base[i]
                   how0 == IF b = NoBase THEN "unknown" ELSE IF forced[i] THEN "merged" ELSE IF ~Foreign(i, b) THEN "fast" ELSE IF b < floor THEN "pruned" ELSE "merged"
                   \* "plain": a merged write the server then holds exactly as the page does (AfterMerge), stored and based like a fast one
                   how == IF how0 = "merged" /\ AdvanceBase /\ (AfterMerge = "always" \/ (AfterMerge = "ifempty" /\ TookNothing(t, bst[i]))) THEN "plain" ELSE how0
                   \* "ifempty" stores the page's own bytes (dbSync.cjs); "always" keeps the merged result but drops the forced merge
                   new == IF how = "merged" \/ (how = "plain" /\ AfterMerge = "always") THEN Merged(t, bst[i]) ELSE local[t]
               IN /\ server' = new /\ rev' = rev + 1 /\ hist' = [hist EXCEPT ![rev + 1] = new] /\ writer' = [writer EXCEPT ![rev + 1] = i]
                  /\ base' = IF how \in {"unknown", "pruned"} \/ (AdvanceBase /\ how \in {"fast", "plain"}) THEN [base EXCEPT ![i] = rev + 1] ELSE base
                  \* the stored file is the page's own: that is its base. AdvanceBase: after ANY write the page holds what it wrote; when
                  \* that was merged the server holds more than the page, so its next write must merge (dbSync.cjs: a negative manifest id)
                  /\ bst' = IF how \in {"unknown", "pruned"} \/ AdvanceBase THEN [bst EXCEPT ![i] = local[t]] ELSE bst
                  /\ forced' = IF AdvanceBase THEN [forced EXCEPT ![i] = (how = "merged")] ELSE forced
            /\ synced' = [synced EXCEPT ![t] = local[t]]
            /\ UNCHANGED <<local, tabRev, loaded, floor, edits>>

Next == \E t \in Tabs : Read(t) \/ Write(t) \/ (\E k \in Keys : Edit(t, k)) \/ (\E r \in 1..MaxRev : ReadBackup(t, r))
Spec == Init /\ [][Next]_vars

\* a key the writing tab did not change (against what IT loaded) keeps the server's value: nobody's acknowledged edit is overwritten
NoLostUpdate == [][ \A t \in Tabs : Write(t) => \A k \in Keys : (local[t][k] = hist[tabRev[t]][k]) => server'[k] = server[k] ]_vars
\* and the writer's own edit is stored
OwnEditKept == [][ \A t \in Tabs : Write(t) => \A k \in Keys : (local[t][k] # hist[tabRev[t]][k]) => server'[k] = local[t][k] ]_vars
\* the same two, against what the tab last read or WROTE: a write the server acknowledged is not an edit again in the next write
NoLostUpdateSinceSync == [][ \A t \in Tabs : Write(t) => \A k \in Keys : (local[t][k] = synced[t][k]) => server'[k] = server[k] ]_vars
OwnEditKeptSinceSync == [][ \A t \in Tabs : Write(t) => \A k \in Keys : (local[t][k] # synced[t][k]) => server'[k] = local[t][k] ]_vars
====
