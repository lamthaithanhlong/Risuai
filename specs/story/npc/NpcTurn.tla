---------------------------- MODULE NpcTurn ----------------------------
\* The NPC psychology's numbers per turn (story/gm/npc.lp reads them; plan §4, §6, §14, risk 2): the bookkeeper writes the reply's
\* social acts into the ledger ($led_soc, lines "n | who | tag | whom"), a reroll takes the last reply's lines away (settlePanel puts
\* the $panel_log snapshot back), the page's request carries the ledger, and the server turns the lines into numbers (a FOLD of the
\* lines with a clamp after each one; never incremented in place).
\* One reply = at most one social act (who, tag), whom is always the player's character. The bookkeeper is one submodel call per
\* reply: it may be asked twice (a re-run), answers late (any time while its reply is still the last one: after the next request left,
\* even after the server decided) and is dropped once the reply is not last (reroll, next reply). It answers what the reply shows.
\* The ledger is what was RECORDED: a bookkeeper answer that comes after the next request left reaches the NEXT request, so
\* "complete" means complete against the ledger the request carries, not against what the replies showed.
\*   Engine = "request"  the server folds the lines of the REQUEST (FIXED; the sidecar's prefix cache is the same fold over the same lines)
\*   Engine = "table"    the server folds a TABLE synced from the ledger after the fact, so it may lag a request (STALE mutant)
\*   Dedupe = TRUE       appendSocial skips a line already in the ledger on (n, who, tag, whom) (FIXED);  FALSE: every answer appends
\* Invariants, at the moment the numbers are used ("decided"):
\*   ReadComplete   the lines the numbers were folded from are exactly the lines of the request: none missing, none extra
\*   OncePerReply   no line is folded twice (one act of one reply moves the numbers once)
\*   RerollClean    no line of a reply that is gone, or of an act the reply no longer shows, is in the ledger or in what is folded
\*   Clamped        every number is in 0..100 (Clamp = FALSE shows the invariant can fail: the deltas here are big on purpose)
EXTENDS Integers, Sequences, FiniteSets
CONSTANTS Npcs, Tags, MaxTurn, Engine, Dedupe, Clamp
VARIABLES replies, truth, ledger, table, phase, reqLedger, used, nums, issued, pending
vars == <<replies, truth, ledger, table, phase, reqLedger, used, nums, issued, pending>>

Whom == "player"
Events == Npcs \X Tags
Delta == [t \in Tags |-> IF t = "help" THEN 40 ELSE -40]    \* big on purpose: 2 acts leave 0..100 (the real table's steps are 1..30)
Seed == [e \in Npcs |-> 50]
Cl(x) == IF ~Clamp THEN x ELSE IF x < 0 THEN 0 ELSE IF x > 100 THEN 100 ELSE x
RECURSIVE Fold(_, _)
Fold(v, s) == IF s = <<>> THEN v
              ELSE LET l == Head(s) IN Fold([v EXCEPT ![l[2]] = Cl(v[l[2]] + Delta[l[3]])], Tail(s))
Lines(s) == {s[i] : i \in DOMAIN s}

TypeOK == /\ replies \in 0..MaxTurn /\ phase \in {"idle", "asked", "decided"}
          /\ issued \subseteq 1..2 /\ pending \subseteq issued

Init == /\ replies = 0 /\ truth = [n \in 1..MaxTurn |-> {}] /\ ledger = <<>> /\ table = <<>>
        /\ phase = "idle" /\ reqLedger = <<>> /\ used = <<>> /\ nums = Seed /\ issued = {} /\ pending = {}

\* the page sends the request: it carries the ledger as it is now
Request == /\ phase = "idle" /\ replies < MaxTurn
           /\ phase' = "asked" /\ reqLedger' = ledger
           /\ UNCHANGED <<replies, truth, ledger, table, used, nums, issued, pending>>
\* the server decides: its numbers come from the request's lines or from the table
Decide == /\ phase = "asked"
          /\ used' = IF Engine = "request" THEN reqLedger ELSE table
          /\ nums' = Fold(Seed, used') /\ phase' = "decided"
          /\ UNCHANGED <<replies, truth, ledger, table, reqLedger, issued, pending>>
\* the narrator's reply arrives and shows at most one act; the older reply's bookkeeper is no longer for the last reply
Reply == /\ phase = "decided" /\ replies < MaxTurn
         /\ replies' = replies + 1 /\ \E a \in {{}} \cup {{e} : e \in Events} : truth' = [truth EXCEPT ![replies + 1] = a]
         /\ phase' = "idle" /\ issued' = {} /\ pending' = {}
         /\ UNCHANGED <<ledger, table, reqLedger, used, nums>>
\* a bookkeeper call for the last reply (the first one, or a re-run)
Bookkeep == /\ replies > 0 /\ \E k \in 1..2 \ issued : issued' = issued \cup {k} /\ pending' = pending \cup {k}
            /\ UNCHANGED <<replies, truth, ledger, table, phase, reqLedger, used, nums>>
\* its answer arrives, possibly late, while its reply is still the last one: appendSocial
Answer == /\ replies > 0 /\ \E k \in pending :
              /\ pending' = pending \ {k}
              /\ \/ truth[replies] = {} /\ UNCHANGED ledger
                 \/ \E e \in truth[replies] :
                      LET line == <<replies, e[1], e[2], Whom>> IN
                      ledger' = IF Dedupe /\ line \in Lines(ledger) THEN ledger ELSE Append(ledger, line)
          /\ UNCHANGED <<replies, truth, table, phase, reqLedger, used, nums, issued>>
\* a reroll takes the last reply away; settlePanel puts back the ledger from before it (its lines go)
Reroll == /\ phase = "idle" /\ replies > 0
          /\ replies' = replies - 1 /\ truth' = [truth EXCEPT ![replies] = {}]
          /\ ledger' = SelectSeq(ledger, LAMBDA l : l[1] # replies)
          /\ issued' = {} /\ pending' = {}
          /\ UNCHANGED <<table, phase, reqLedger, used, nums>>
\* the table is synced from the ledger some time after a save (only the table engine reads it)
Sync == /\ Engine = "table" /\ table # ledger /\ table' = ledger
        /\ UNCHANGED <<replies, truth, ledger, phase, reqLedger, used, nums, issued, pending>>
Idle == /\ replies = MaxTurn /\ phase = "idle" /\ UNCHANGED vars

Next == Request \/ Decide \/ Reply \/ Bookkeep \/ Answer \/ Reroll \/ Sync \/ Idle
Spec == Init /\ [][Next]_vars

\* a line belongs to a reply that is there and to the act that reply shows
Good(l) == l[1] <= replies /\ {<<l[2], l[3]>>} = truth[l[1]]
ReadComplete == phase = "decided" => Lines(used) = Lines(reqLedger)
OncePerReply == phase = "decided" => \A i, j \in DOMAIN used : i # j => used[i] # used[j]
RerollClean  == (\A i \in DOMAIN ledger : Good(ledger[i])) /\ (phase = "decided" => \A i \in DOMAIN used : Good(used[i]))
Clamped == phase = "decided" => \A e \in Npcs : nums[e] \in 0..100
=============================================================================
