/*
 * Keys and jobs of the durable stream-job queue (server/node/jobStore.cjs, POST /proxy-stream-jobs).
 *
 * A generation asks for a job with an idempotency key. The server reuses a job for that key while it is running or
 * done; otherwise it creates a new one. Jobs end in one of four ways and never change after that.
 *
 *   check AtMostOneReusablePerKey : two jobs of one key are never reusable at once (no "which reply is mine?")
 *   check TerminalStaysTerminal   : a finished job never goes back to running, nor to another outcome
 *   check ReuseNeverSkipsAFailure : asking again after a failure creates a new job, never returns the failed one
 *   run   FailureThenNewJob       : witness, a key's first job fails and a second job serves it
 */
open util/ordering[Time]

sig Time {}
abstract sig Status {}
one sig Running, Done, Failed, Aborted, Interrupted extends Status {}
fun Reusable : set Status { Running + Done }
fun Final    : set Status { Done + Failed + Aborted + Interrupted }

sig Key {}
sig Job {
    key    : one Key,
    status : Status one -> Time,      // meaningful only while the job exists
    exists : set Time                  // from creation onward
}

fun alive[t: Time] : set Job { exists.t }

pred reusableFor[t: Time, k: Key, j: Job] {
    j in alive[t] and j.key = k and j.status.t in Reusable
}

// POST with key k at t, result at tn
pred post[t, tn: Time, k: Key] {
    (some j: Job | reusableFor[t, k, j])
    =>  { exists.tn = exists.t  and  all j: Job | j.status.tn = j.status.t }
    else { some n: Job - alive[t] {
               n.key = k
               n.status.tn = Running
               exists.tn = exists.t + n
               all j: Job - n | j.status.tn = j.status.t
           } }
}

// a running job ends
pred finish[t, tn: Time, j: Job, s: Status] {
    j in alive[t] and j.status.t = Running and s in Final
    j.status.tn = s
    exists.tn = exists.t
    all o: Job - j | o.status.tn = o.status.t
}

pred step[t, tn: Time] {
    (some k: Key | post[t, tn, k]) or (some j: Job, s: Status | finish[t, tn, j, s])
}

fact trace {
    no exists.first
    all t: Time - last | step[t, t.next]
}

assert AtMostOneReusablePerKey {
    all t: Time, k: Key | lone { j: alive[t] | j.key = k and j.status.t in Reusable }
}
check AtMostOneReusablePerKey for 4 Key, 6 Job, 8 Time

assert TerminalStaysTerminal {
    all t: Time - last, j: alive[t] | j.status.t in Final => j.status.(t.next) = j.status.t
}
check TerminalStaysTerminal for 4 Key, 6 Job, 8 Time

// a job that failed is never what a later request for its key gets back
assert ReuseNeverSkipsAFailure {
    all t: Time - last, k: Key, j: alive[t] |
        (j.key = k and j.status.t in Failed + Aborted + Interrupted and (some n: alive[t.next] - alive[t] | n.key = k))
            => (j.status.(t.next) not in Reusable)
}
check ReuseNeverSkipsAFailure for 4 Key, 6 Job, 8 Time

pred FailureThenNewJob {
    some k: Key, j1, j2: Job, t: Time | j1 != j2 and j1.key = k and j2.key = k and
        j1 in alive[t] and j1.status.t = Failed and j2 in alive[t] and j2.status.t in Reusable
}
run FailureThenNewJob for 3 Key, 4 Job, 8 Time
