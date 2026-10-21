---------------------------- MODULE GraphSync ----------------------------
\* The librarian's per-turn update (server/node/storyGraph.cjs syncChat) against the reads (facts / query).
\* The chat's ledger is a set of lines; each turn the narrator may add a line, a reroll may take the last turn's line away
\* (and a later turn may write the very same line again). After a save, syncChat rebuilds the chat's facts from the ledger in
\* ONE transaction; kg_seen keeps the turn each line was first seen, so valid_from does not move from turn to turn.
\* The page reads the facts at any moment (POST /api/story/facts).
\*   Atomic        a read sees a whole rebuild, never half (better-sqlite3 runs the transaction synchronously: modelled as one step)
\*   NoGhost       after a sync, no fact without its line (a rerolled line takes its fact with it)
\*   Exact         with a sync after every change (LAG = FALSE), a line's valid_from is the turn it was last ADDED: a line rerolled
\*                 away and written again later is a new event
\*   NotFuture     with any lag, valid_from is never after now. (With lag the ledger carries no turn, so a line is dated by the first
\*                 sync that saw it, and a reroll plus the same line again between two syncs cannot be told apart: TLC shows both.)
\* Found by TLC with KEEP_SEEN = TRUE (the first version kept kg_seen rows of lines that left the ledger): a, reroll, a again ->
\* valid_from = the first, rerolled-away turn. storyGraph.cjs now drops those rows on every rebuild (KEEP_SEEN = FALSE).
\* And with either: a sync that lagged dated a line at turn 2, a reroll took turn 2 back, and the line kept valid_from 2 > now;
\* a first-seen turn after now is now taken as now.
EXTENDS Naturals, FiniteSets
CONSTANTS Lines, MaxTurn, KEEP_SEEN, LAG
\* KEEP_SEEN = TRUE: kg_seen keeps rows of lines that left the ledger (the first version)
\* LAG = FALSE: every change of the chat is saved and synced before the next one (Risu saves after each message change and
\* storyStore syncs every stored write); LAG = TRUE: changes may pile up between two syncs
VARIABLES turn, ledger, addedAt, facts, seen, synced, read
vars == <<turn, ledger, addedAt, facts, seen, synced, read>>

Init == /\ turn = 0 /\ ledger = {} /\ addedAt = [l \in Lines |-> 0] /\ facts = {} /\ seen = [l \in Lines |-> 0]
        /\ synced = TRUE /\ read = {}

\* a turn: the narrator's reply adds a line (or none)
Turn(l) == /\ turn < MaxTurn /\ l \notin ledger /\ (LAG \/ synced)
           /\ turn' = turn + 1 /\ ledger' = ledger \cup {l} /\ addedAt' = [addedAt EXCEPT ![l] = turn + 1]
           /\ synced' = FALSE /\ UNCHANGED <<facts, seen, read>>
\* a reroll replaces the LAST reply: the line that reply wrote leaves the ledger and the chat is one message shorter until the new
\* reply comes (which may write the same line again, at the same turn)
Reroll(l) == /\ l \in ledger /\ addedAt[l] = turn /\ turn > 0 /\ (LAG \/ synced)
             /\ ledger' = ledger \ {l} /\ turn' = turn - 1 /\ synced' = FALSE /\ UNCHANGED <<addedAt, facts, seen, read>>
\* the save's sync: one transaction rebuilds the chat's facts; kg_seen gives each line its first-seen turn
Sync == /\ ~synced
        /\ LET first(l) == IF seen[l] # 0 /\ seen[l] <= turn THEN seen[l] ELSE turn   \* a turn a reroll took back is no turn
           IN /\ facts' = { <<l, first(l)>> : l \in ledger }
              /\ seen' = [l \in Lines |-> IF l \in ledger THEN first(l) ELSE IF KEEP_SEEN THEN seen[l] ELSE 0]
        /\ synced' = TRUE /\ UNCHANGED <<turn, ledger, addedAt, read>>
\* a read takes the facts as they are at that moment
Read == /\ read' = facts /\ UNCHANGED <<turn, ledger, addedAt, facts, seen, synced>>

Next == \/ \E l \in Lines : Turn(l) \/ Reroll(l)
        \/ Sync \/ Read
Spec == Init /\ [][Next]_vars

\* a read sees one fact per line (a half-rebuilt chat would show a line twice or a line without its turn)
Atomic == \A f1, f2 \in read : f1[1] = f2[1] => f1 = f2
NoGhost == synced => \A f \in facts : f[1] \in ledger
\* never a turn after now, whatever the lag
NotFuture == synced => \A f \in facts : f[2] <= turn
\* with a sync after every change: exactly the turn the line was (last) added
Exact == synced => \A f \in facts : f[2] = addedAt[f[1]]
=============================================================================
