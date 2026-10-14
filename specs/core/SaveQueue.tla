---------------------------- MODULE SaveQueue ----------------------------
(* The save queue (server/node/saveQueue.cjs): /api/write puts the file in a SQLite table (at most one row per key) and answers
   "success"; a single worker applies rows to the save directory in sequence order and then deletes the row. /api/read looks at the
   table before the directory.
   Two keys. A is an asset: its key is a hash of its bytes, so writing it again writes the same bytes. D is database.bin: each
   version replaces the last, and D n points at A, so the directory must never hold a D while A is missing.
   InOrder = TRUE : the worker takes the row with the lowest sequence number.  FALSE: it takes any row.
   AssetPolicy = "replace": writing A while a row for A is pending replaces that row, which moves it to the END of the queue.
   AssetPolicy = "ignore" : the pending row for A stays where it is (same bytes), so it keeps its place.
   SkipBackoff = TRUE : a row whose apply failed waits in backoff and the worker goes on with the next row (the first version of the
                        code: its query only looked at rows whose retry time had come).  FALSE: the worker waits for it, nothing overtakes.
   Crash loses the worker's memory (it may be between "file written" and "row deleted"), never the table. *)
EXTENDS Naturals, FiniteSets
CONSTANTS MaxVer, InOrder, AssetPolicy, SkipBackoff
Keys == {"A", "D"}
VARIABLES disk,    \* key -> version in the save directory (0 = no file)
          rows,    \* the table: a set of [key, ver, seq]
          acked,   \* key -> newest version acknowledged to the client
          nseq,    \* next sequence number
          backoff, \* rows whose last apply failed and that wait for their retry time
          inflight \* the row the worker wrote to the directory but has not deleted yet, as a set of at most one row

vars == <<disk, rows, acked, nseq, inflight, backoff>>

Init == disk = [k \in Keys |-> 0] /\ rows = {} /\ acked = [k \in Keys |-> 0] /\ nseq = 1 /\ inflight = {} /\ backoff = {}

PendingRows(k) == {r \in rows : r.key = k}

\* the client writes the asset (any time, also again), then database versions that point at it
EnqA == /\ nseq < 9
        /\ IF AssetPolicy = "ignore" /\ PendingRows("A") # {}
             THEN UNCHANGED <<rows, nseq>>
             ELSE /\ rows' = (rows \ PendingRows("A")) \cup {[key |-> "A", ver |-> 1, seq |-> nseq]} /\ nseq' = nseq + 1
        /\ acked' = [acked EXCEPT !["A"] = 1] /\ UNCHANGED <<disk, inflight, backoff>>
EnqD == /\ nseq < 9 /\ acked["A"] = 1 /\ acked["D"] < MaxVer
        /\ rows' = (rows \ PendingRows("D")) \cup {[key |-> "D", ver |-> acked["D"] + 1, seq |-> nseq]}
        /\ acked' = [acked EXCEPT !["D"] = acked["D"] + 1] /\ nseq' = nseq + 1 /\ UNCHANGED <<disk, inflight, backoff>>

MinSeq == CHOOSE r \in rows : \A s \in rows : r.seq <= s.seq
MinSeqOf(S) == CHOOSE r \in S : \A s \in S : r.seq <= s.seq

\* the worker, step 1: write the file (atomically: the directory holds the old or the new version, never a half file)
Write == /\ inflight = {} /\ rows # {}
         /\ \E r \in rows : r \notin backoff /\ (IF SkipBackoff THEN r = MinSeqOf(rows \ backoff) ELSE (~InOrder \/ r = MinSeq)) /\ disk' = [disk EXCEPT ![r.key] = r.ver] /\ inflight' = {r}
         /\ UNCHANGED <<rows, acked, nseq, backoff>>
\* step 2: delete that row (a newer write for the key may have replaced it, then the new row stays)
Done == /\ inflight # {} /\ rows' = rows \ inflight /\ backoff' = backoff \ inflight /\ inflight' = {} /\ UNCHANGED <<disk, acked, nseq>>
Crash == /\ inflight # {} /\ inflight' = {} /\ UNCHANGED <<disk, rows, acked, nseq, backoff>>
\* an apply fails before writing anything: the row waits in backoff (the head of the queue when InOrder and not SkipBackoff)
Fail == /\ inflight = {} /\ \E r \in rows : r = MinSeq /\ r \notin backoff /\ backoff' = backoff \cup {r} /\ UNCHANGED <<disk, rows, acked, nseq, inflight>>
\* the retry time arrives
RetryTime == /\ backoff # {} /\ backoff' = {} /\ UNCHANGED <<disk, rows, acked, nseq, inflight>>

Next == EnqA \/ EnqD \/ Write \/ Done \/ Crash \/ Fail \/ RetryTime
Spec == Init /\ [][Next]_vars

\* what /api/read answers: the pending row if there is one, else the directory
ReadVal(k) == IF PendingRows(k) = {} THEN disk[k]
              ELSE (CHOOSE r \in PendingRows(k) : \A s \in PendingRows(k) : s.seq <= r.seq).ver

\* 1. A client reads back what was last acknowledged for a key, at any moment (also right after a crash)
ReadsAcked == \A k \in Keys : ReadVal(k) = acked[k]
\* 2. The directory never goes back to an older version of the database
DiskNeverRegresses == [][disk'["D"] >= disk["D"]]_vars
\* 3. The directory never holds a database whose asset is missing (what a crash right now would leave behind)
DiskIsConsistent == disk["D"] > 0 => disk["A"] = 1
=============================================================================
