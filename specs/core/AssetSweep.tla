---------------------------- MODULE AssetSweep ----------------------------
(* Risu's startup cleanup (bootstrap.ts cleanChunks) deletes every asset file that the database does not reference.
   It runs without being awaited right after the app opens, and two clients (a phone and a Mac tab) share one server.
   A client that imports an asset writes the file first and saves the database that references it later.
   Safety: every asset the saved database references still exists.
   TwoStrike = FALSE: delete at once what the snapshot does not reference (the shipped behaviour).
   TwoStrike = TRUE : first run only marks such files, a later run deletes the ones still unreferenced and still marked. *)
EXTENDS FiniteSets
CONSTANTS Assets, TwoStrike
VARIABLES files,   \* asset files on the server
          refs,    \* assets the saved database references
          pending, \* assets written by an importing client whose database save has not landed yet
          snap, marked, pc

vars == <<files, refs, pending, snap, marked, pc>>

Init == files = {} /\ refs = {} /\ pending = {} /\ snap = {} /\ marked = {} /\ pc = "idle"

\* an importing client: write the file, then later save the database that references it
Write(a)  == /\ a \notin files /\ files' = files \cup {a} /\ pending' = pending \cup {a}
             /\ UNCHANGED <<refs, snap, marked, pc>>
Commit(a) == /\ a \in pending /\ refs' = refs \cup {a} /\ pending' = pending \ {a}
             /\ UNCHANGED <<files, snap, marked, pc>>

\* the cleaning client (cleanChunks): snapshot the references, list the files, delete
Snap   == /\ pc = "idle" /\ pc' = "sweep" /\ snap' = refs /\ UNCHANGED <<files, refs, pending, marked>>
Sweep  == /\ pc = "sweep" /\ pc' = "idle"
          /\ IF TwoStrike
               THEN /\ files' = files \ ((files \ snap) \cap marked)
                    /\ marked' = (files \ snap) \ marked   \* the unreferenced files seen for the first time
               ELSE /\ files' = files \cap snap
                    /\ marked' = marked
          /\ UNCHANGED <<refs, pending, snap>>

\* The two-strike rule needs the next run to come after any in-flight import has saved its database. Model that as the
\* assumption it is: a run may only start when nothing is pending.
SnapGuarded == IF TwoStrike THEN pending = {} ELSE TRUE

Next == \/ (\E a \in Assets : Write(a))
        \/ (\E a \in Assets : Commit(a))
        \/ (SnapGuarded /\ Snap)
        \/ Sweep

Spec == Init /\ [][Next]_vars

Safe == refs \subseteq files
=============================================================================
