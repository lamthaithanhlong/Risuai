---------------------------- MODULE SaveStore ----------------------------
(* Lost updates on database.bin with the save in SQLite (server/node/saveStore.cjs).
   Three kinds of writer change the one key D:
     page writes  /api/write: read the newest state (the queue row, else the store), merge the page's change in (dbSync), put the
                  result in the save queue; the queue's worker later applies the row to the store (Apply).
     imports      loreImport.cjs, another process: read the store, change it, write it back.
   A state is the set of changes it contains; a writer that read state S writes S \cup {its change}.
   AtomicCli   = TRUE : an import's read, change and write are one BEGIN IMMEDIATE transaction (store.update).
                 FALSE: read, then a separate write (what the files backend can do).
   CliGuard    = TRUE : an import runs only with the server stopped and the queue empty (loreImport checks the port, the pid file
                 and save.queue.sqlite).  FALSE: it may run any time.
   ServerAwait = TRUE : a page write awaits between its read and its enqueue (someone adds an await in /api/write).
                 FALSE: read, merge and enqueue run in one turn of the event loop, as the code does today.
   NoLostUpdate: every acknowledged change is in the newest state a reader sees.
   TLC: SaveStore_TRUE.cfg holds; SaveStore_TWOCLI.cfg (AtomicCli = FALSE), SaveStore_NOGUARD.cfg (CliGuard = FALSE) and
   SaveStore_AWAIT.cfg (ServerAwait = TRUE) each break NoLostUpdate. *)
EXTENDS Naturals, FiniteSets
CONSTANTS AtomicCli, CliGuard, ServerAwait
Pages == {"p1", "p2"}
Clis == {"c1", "c2"}
NONE == {"none"}   \* "nothing": a set no state can be (no change is called "none")
VARIABLES store,    \* the set of changes in the store's row for D
          queue,    \* the pending queue row for D (a set of changes), or NONE
          acked,    \* changes acknowledged to whoever made them
          up,       \* the server is running
          pread,    \* page -> what it read (ServerAwait), or NONE
          cread     \* import -> what it read (AtomicCli = FALSE), or NONE
vars == <<store, queue, acked, up, pread, cread>>

Init == store = {} /\ queue = NONE /\ acked = {} /\ up = TRUE /\ pread = [p \in Pages |-> NONE] /\ cread = [c \in Clis |-> NONE]

Newest == IF queue # NONE THEN queue ELSE store
Free(x) == x \notin acked

\* ---- page writes (the server) ----
PageWrite(p) == /\ ~ServerAwait /\ up /\ Free(p)
                /\ queue' = Newest \cup {p} /\ acked' = acked \cup {p} /\ UNCHANGED <<store, up, pread, cread>>
PageRead(p)  == /\ ServerAwait /\ up /\ Free(p) /\ pread[p] = NONE
                /\ pread' = [pread EXCEPT ![p] = Newest] /\ UNCHANGED <<store, queue, acked, up, cread>>
PageEnq(p)   == /\ ServerAwait /\ up /\ pread[p] # NONE
                /\ queue' = pread[p] \cup {p} /\ acked' = acked \cup {p} /\ pread' = [pread EXCEPT ![p] = NONE] /\ UNCHANGED <<store, up, cread>>
Apply        == /\ queue # NONE /\ store' = queue /\ queue' = NONE /\ UNCHANGED <<acked, up, pread, cread>>
\* SIGTERM flushes the queue before the process exits (a row whose apply keeps failing stays, see CliGuard)
Stop         == /\ up /\ \A p \in Pages : pread[p] = NONE /\ up' = FALSE /\ UNCHANGED <<store, queue, acked, pread, cread>>
Start        == /\ ~up /\ up' = TRUE /\ UNCHANGED <<store, queue, acked, pread, cread>>
\* ---- imports (another process, on the store) ----
CliMay == ~CliGuard \/ (~up /\ queue = NONE)
CliAtomic(c) == /\ AtomicCli /\ Free(c) /\ CliMay
                /\ store' = store \cup {c} /\ acked' = acked \cup {c} /\ UNCHANGED <<queue, up, pread, cread>>
CliRead(c)   == /\ ~AtomicCli /\ Free(c) /\ cread[c] = NONE /\ CliMay
                /\ cread' = [cread EXCEPT ![c] = store] /\ UNCHANGED <<store, queue, acked, up, pread>>
CliWrite(c)  == /\ ~AtomicCli /\ cread[c] # NONE
                /\ store' = cread[c] \cup {c} /\ acked' = acked \cup {c} /\ cread' = [cread EXCEPT ![c] = NONE] /\ UNCHANGED <<queue, up, pread>>

Next == \/ \E p \in Pages : PageWrite(p) \/ PageRead(p) \/ PageEnq(p)
        \/ \E c \in Clis : CliAtomic(c) \/ CliRead(c) \/ CliWrite(c)
        \/ Apply \/ Stop \/ Start
Spec == Init /\ [][Next]_vars

TypeOK == store \subseteq (Pages \cup Clis) /\ up \in BOOLEAN /\ (queue = NONE \/ queue \subseteq (Pages \cup Clis))
NoLostUpdate == acked \subseteq Newest
=============================================================================
