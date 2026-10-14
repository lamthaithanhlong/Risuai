---------------------------- MODULE MirrorRace ----------------------------
(* The cloud mirror sends database.bin after the assets. Safety: the database in the account never points at an asset that
   the account lacks. The Risu server (a chat) adds an asset first and writes the database that references it second, at any
   moment, while the mirror pass runs.
   CheckAfterRead = FALSE: the "all assets are in the account" check runs before the database is read (the first version).
   CheckAfterRead = TRUE : the check runs after the read (the fix). *)
EXTENDS FiniteSets
CONSTANTS Assets, CheckAfterRead
VARIABLES localA,      \* asset files on the server
          localRefs,   \* assets the server's database.bin points at
          cloudA,      \* assets in the account
          cloudRefs,   \* assets the account's database.bin points at
          pc, listed, snap

vars == <<localA, localRefs, cloudA, cloudRefs, pc, listed, snap>>

Init == /\ localA = {} /\ localRefs = {} /\ cloudA = {} /\ cloudRefs = {}
        /\ pc = "idle" /\ listed = {} /\ snap = {}

\* server side: the asset file is written first, the database that references it later
AddAsset(a) == /\ a \notin localA /\ localA' = localA \cup {a}
               /\ UNCHANGED <<localRefs, cloudA, cloudRefs, pc, listed, snap>>
CommitDb == /\ localRefs # localA /\ localRefs' = localA
            /\ UNCHANGED <<localA, cloudA, cloudRefs, pc, listed, snap>>

\* mirror pass
List   == /\ pc = "idle" /\ pc' = "upload" /\ listed' = localA
          /\ UNCHANGED <<localA, localRefs, cloudA, cloudRefs, snap>>
Upload == /\ pc = "upload" /\ cloudA' = cloudA \cup listed
          /\ pc' = IF CheckAfterRead THEN "read" ELSE "check"
          /\ UNCHANGED <<localA, localRefs, cloudRefs, listed, snap>>
Check  == /\ pc = "check"
          /\ IF localA \subseteq cloudA THEN pc' = "read" ELSE pc' = "idle"
          /\ UNCHANGED <<localA, localRefs, cloudA, cloudRefs, listed, snap>>
Read   == /\ pc = "read" /\ snap' = localRefs
          /\ pc' = IF CheckAfterRead THEN "check2" ELSE "send"
          /\ UNCHANGED <<localA, localRefs, cloudA, cloudRefs, listed>>
Check2 == /\ pc = "check2"
          /\ IF localA \subseteq cloudA THEN pc' = "send" ELSE pc' = "idle"
          /\ UNCHANGED <<localA, localRefs, cloudA, cloudRefs, listed, snap>>
Send   == /\ pc = "send" /\ cloudRefs' = snap /\ pc' = "idle"
          /\ UNCHANGED <<localA, localRefs, cloudA, listed, snap>>

Next == \/ \E a \in Assets : AddAsset(a)
        \/ CommitDb \/ List \/ Upload \/ Check \/ Read \/ Check2 \/ Send

Spec == Init /\ [][Next]_vars

\* the database in the account never points at a file the account lacks
Safe == cloudRefs \subseteq cloudA
=============================================================================
