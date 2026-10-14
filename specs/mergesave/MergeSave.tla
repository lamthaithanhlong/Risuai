---- MODULE MergeSave ----
\* Two pages (a phone and a laptop tab) load the same save, edit different parts of it and write the whole file back. Today the last
\* write wins for the whole file, so a page that never touched the lorebook still overwrites it with the copy it loaded (seen five times
\* in one day: Max Response 4096 -> 1000, the lorebook back to 305 entries, a chat).
\*   Policy = "LWW"   : the server stores what it is given
\*   Policy = "Merge" : three-way merge by key against what the writer loaded: a key the writer did not change keeps the server's value,
\*                      a key it changed takes its value
EXTENDS Naturals, FiniteSets

CONSTANTS Keys, Clients, MaxEdits, Policy

VARIABLES server, rev, hist, local, base, loaded, edits

vars == <<server, rev, hist, local, base, loaded, edits>>

Zero == [k \in Keys |-> 0]

Init == /\ server = Zero /\ rev = 0 /\ hist = [r \in 0..MaxEdits |-> Zero]
        /\ local = [c \in Clients |-> Zero] /\ base = [c \in Clients |-> 0] /\ loaded = [c \in Clients |-> FALSE] /\ edits = 0

\* a page loads the current save and remembers which revision it is
Read(c) == /\ local' = [local EXCEPT ![c] = server] /\ base' = [base EXCEPT ![c] = rev] /\ loaded' = [loaded EXCEPT ![c] = TRUE]
           /\ UNCHANGED <<server, rev, hist, edits>>
\* the user changes one part in the page; each edit is a new, globally ordered version
Edit(c, k) == /\ loaded[c] /\ edits < MaxEdits
              /\ edits' = edits + 1 /\ local' = [local EXCEPT ![c][k] = edits + 1]
              /\ UNCHANGED <<server, rev, hist, base, loaded>>
Merged(c) == [k \in Keys |-> IF local[c][k] = hist[base[c]][k] THEN server[k] ELSE local[c][k]]
\* the page writes the whole file; at most MaxEdits revisions exist
Write(c) == /\ loaded[c] /\ rev < MaxEdits
            /\ LET new == IF Policy = "LWW" THEN local[c] ELSE Merged(c)
               IN /\ server' = new /\ rev' = rev + 1 /\ hist' = [hist EXCEPT ![rev + 1] = new]
            /\ UNCHANGED <<local, base, loaded, edits>>

Next == \E c \in Clients : Read(c) \/ Write(c) \/ (\E k \in Keys : Edit(c, k))
Spec == Init /\ [][Next]_vars

\* ---- what a write must do ----
NewValue(c) == IF Policy = "LWW" THEN local[c] ELSE Merged(c)

\* a key the writer did not change keeps what the server has: a page that never touched the lorebook does not overwrite it
NoStaleOverwrite == [][ \A c \in Clients : Write(c) => \A k \in Keys : (local[c][k] = hist[base[c]][k]) => server'[k] = server[k] ]_vars
\* a key the writer did change takes the writer's value (its own edit is never lost)
ChangedKeysWin == [][ \A c \in Clients : Write(c) => \A k \in Keys : (local[c][k] # hist[base[c]][k]) => server'[k] = local[c][k] ]_vars
\* a page that changed nothing and writes anyway changes nothing on the server
TouchNothing == \A c \in Clients : (loaded[c] /\ local[c] = hist[base[c]]) => NewValue(c) = server
\* when nobody wrote since the page loaded, the result is the page's own copy (the fast path)
FastPath == \A c \in Clients : (loaded[c] /\ rev = base[c]) => NewValue(c) = local[c]
====
