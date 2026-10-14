---------------------------- MODULE SaveLoad ----------------------------
(* Saving and loading database.bin (server.cjs /api/write, globalApi.svelte.ts saveDb, bootstrap.ts, risuSave.ts RisuSaveDecoder).
   Save:  the server writes the file in place (Atomic = FALSE: truncate then write) or through a temp file and a rename (TRUE).
          After the main file the client writes a backup copy; at most MaxB backups are kept, newest first.
   Load:  read the file. If it decodes, use it. If it does not, fall back to the backups.
          Strict = FALSE: a file with a missing tail still "decodes" into a database missing its last blocks (the decoder skips
                          blocks it cannot parse and does not check the block directory).  Strict = TRUE: it is rejected.
          Fallback = "oldest": the loop has no break, so every backup overwrites the previous and the OLDEST decodable one wins.
          Fallback = "newest": stop at the first backup that decodes.
   Corrupt: anything outside the program (crash mid-write, a full disk, a bad copy) can leave the file torn at any time.
   Safety: what is loaded is complete, and it is the newest complete version that exists (file or backup). *)
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS MaxVer, MaxB, Atomic, Strict, Fallback
VARIABLES file,      \* [ver |-> n, ok |-> BOOLEAN]; ok = FALSE is a torn file
          backups,   \* sequence of versions, newest first (every backup is a complete copy)
          writing,   \* TRUE between the truncate and the end of a non-atomic write
          ver,       \* last version number issued
          loaded     \* [ver, ok] of what the last Load put in memory; ver = 0 means nothing loaded

vars == <<file, backups, writing, ver, loaded>>

Init == file = [ver |-> 0, ok |-> TRUE] /\ backups = <<>> /\ writing = FALSE /\ ver = 0 /\ loaded = [ver |-> 0, ok |-> TRUE]

Best(s) == CHOOSE x \in s : \A y \in s : y <= x

\* ---- saving
SaveAtomic == /\ Atomic /\ ~writing /\ ver < MaxVer
              /\ ver' = ver + 1 /\ file' = [ver |-> ver + 1, ok |-> TRUE] /\ UNCHANGED <<backups, writing, loaded>>
SaveBegin == /\ ~Atomic /\ ~writing /\ ver < MaxVer
             /\ ver' = ver + 1 /\ file' = [ver |-> ver + 1, ok |-> FALSE] /\ writing' = TRUE /\ UNCHANGED <<backups, loaded>>
SaveEnd == /\ writing /\ file' = [ver |-> file.ver, ok |-> TRUE] /\ writing' = FALSE /\ UNCHANGED <<backups, ver, loaded>>
\* the process dies in the middle of a non-atomic write: the torn file stays
CrashMid == /\ writing /\ writing' = FALSE /\ UNCHANGED <<file, backups, ver, loaded>>
Backup == /\ ~writing /\ file.ok /\ file.ver > 0
          /\ ~(Len(backups) > 0 /\ backups[1] = file.ver)
          /\ backups' = LET q == <<file.ver>> \o backups IN SubSeq(q, 1, IF Len(q) < MaxB THEN Len(q) ELSE MaxB)
          /\ UNCHANGED <<file, writing, ver, loaded>>
Corrupt == /\ ~writing /\ file.ok /\ file.ver > 0 /\ file' = [ver |-> file.ver, ok |-> FALSE] /\ UNCHANGED <<backups, writing, ver, loaded>>

\* ---- loading (only when nothing is being written)
BackupSet == {backups[i] : i \in 1..Len(backups)}
Load == /\ ~writing
        /\ IF file.ok \/ ~Strict
             THEN loaded' = file                                   \* a torn file decodes into a partial database when not Strict
             ELSE IF BackupSet = {} THEN loaded' = [ver |-> 0, ok |-> TRUE]
             ELSE IF Fallback = "newest" THEN loaded' = [ver |-> backups[1], ok |-> TRUE]
                  ELSE loaded' = [ver |-> backups[Len(backups)], ok |-> TRUE]
        /\ UNCHANGED <<file, backups, writing, ver>>

Next == SaveAtomic \/ SaveBegin \/ SaveEnd \/ CrashMid \/ Backup \/ Corrupt \/ Load
Spec == Init /\ [][Next]_vars

\* the newest complete version that exists, 0 if none
Newest == LET c == (IF file.ok THEN {file.ver} ELSE {}) \cup BackupSet IN IF c = {} THEN 0 ELSE Best(c)

NeverLoadsPartial == loaded.ver > 0 => loaded.ok
\* Whenever a Load happens, it ends with the newest complete version that exists.
LoadsNewestValid == [][Load => loaded'.ver = Newest]_vars

Bound == ver <= MaxVer
=============================================================================
