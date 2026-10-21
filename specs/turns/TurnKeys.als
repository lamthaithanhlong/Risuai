/*
 * Turn keys and turn states (server/node/turnQueue.cjs), against the page-owned turn it replaces.
 *
 * NEW: POST /api/turns {key, chat, input} makes a turn row, or finds the row that key already has (an answer lost on the way, the
 * page asks again). A row goes queued -> active (assembling / generating / tidying are one "Active" here) -> saved | failed, or back
 * to queued for a retry (model error, lost lease); cancel ends a queued or active one. The worker makes a turn active only when its
 * chat has none, and takes the oldest queued turn of the chat.
 * OLD: each page has its own slot (generationKey.ts beginGeneration); a page starts a turn when ITS slot is free. The phone and the
 * Mac on one chat each have one.
 *
 *   check OneActivePerChat_New / _Old : never two active turns on one chat (two replies written into it at once)
 *   check OneTurnPerKey_New           : a key never has two rows (no input answered twice because its POST was retried)
 *   check FinalStaysFinal_New         : saved / failed / cancelled never change again
 *   check InOrder_New                 : a turn never becomes active while an older turn of its chat is still queued
 *   run   RetryThenSaved_New          : witness: a turn is retried and then saved
 */
open util/ordering[Time]

sig Time {}
sig Chat {}
sig Page {}
sig Key {}
abstract sig State {}
one sig Queued, Active, Saved, Failed, Cancelled extends State {}
fun Final : set State { Saved + Failed + Cancelled }

sig Turn {
    key     : one Key,
    chat    : one Chat,
    by      : one Page,                   // the page the input was sent from
    state   : State lone -> Time,         // no state = the row does not exist yet
    born    : lone Time
}
fun rows[t: Time] : set Turn { state.t.State }
fun activeIn[t: Time, c: Chat] : set Turn { { u: rows[t] | u.chat = c and u.state.t = Active } }

pred same[t, tn: Time, except: set Turn] { all u: Turn - except | u.state.tn = u.state.t }

// ---- NEW: the server's queue ----
pred postNew[t, tn: Time, k: Key, c: Chat, p: Page] {
    (some u: rows[t] | u.key = k)
      => same[t, tn, none]
      else some n: Turn - rows[t] { n.key = k and n.chat = c and n.by = p and n.state.tn = Queued and n.born = tn and same[t, tn, n] }
}
pred leaseNew[t, tn: Time, u: Turn] {
    u in rows[t] and u.state.t = Queued and no activeIn[t, u.chat]
    // the oldest queued turn of the chat
    all o: rows[t] | (o.chat = u.chat and o.state.t = Queued and o != u) => lt[u.born, o.born]
    u.state.tn = Active and same[t, tn, u]
}
pred endNew[t, tn: Time, u: Turn, s: State] {
    u in rows[t] and u.state.t = Active and s in Saved + Failed + Queued     // Queued: a retry, or a lease that ran out
    u.state.tn = s and same[t, tn, u]
}
pred cancelNew[t, tn: Time, u: Turn] {
    u in rows[t] and u.state.t in Queued + Active and u.state.tn = Cancelled and same[t, tn, u]
}
pred stepNew[t, tn: Time] {
    (some k: Key, c: Chat, p: Page | postNew[t, tn, k, c, p])
    or (some u: Turn | leaseNew[t, tn, u] or cancelNew[t, tn, u])
    or (some u: Turn, s: State | endNew[t, tn, u, s])
}

// ---- OLD: one slot per page ----
fun activeBy[t: Time, p: Page] : set Turn { { u: rows[t] | u.by = p and u.state.t = Active } }
pred sendOld[t, tn: Time, c: Chat, p: Page] {
    no activeBy[t, p]                       // this page's slot is free (another page's may not be)
    some n: Turn - rows[t] { n.chat = c and n.by = p and n.state.tn = Active and n.born = tn and same[t, tn, n] }
}
pred endOld[t, tn: Time, u: Turn, s: State] {
    u in rows[t] and u.state.t = Active and s in Saved + Failed and u.state.tn = s and same[t, tn, u]
}
pred stepOld[t, tn: Time] {
    (some c: Chat, p: Page | sendOld[t, tn, c, p]) or (some u: Turn, s: State | endOld[t, tn, u, s])
}

pred start { no rows[first] and no born.first }
pred traceNew { start and all t: Time - last | stepNew[t, t.next] }
pred traceOld { start and all t: Time - last | stepOld[t, t.next] }

assert OneActivePerChat_New { traceNew => all t: Time, c: Chat | lone activeIn[t, c] }
check OneActivePerChat_New for 3 but 2 Chat, 2 Page, 3 Key, 4 Turn, 8 Time

assert OneActivePerChat_Old { traceOld => all t: Time, c: Chat | lone activeIn[t, c] }
check OneActivePerChat_Old for 3 but 1 Chat, 2 Page, 3 Key, 4 Turn, 6 Time

assert OneTurnPerKey_New { traceNew => all t: Time, disj u, v: rows[t] | u.key != v.key }
check OneTurnPerKey_New for 3 but 2 Chat, 2 Page, 3 Key, 4 Turn, 8 Time

assert FinalStaysFinal_New { traceNew => all t: Time - last, u: rows[t] | u.state.t in Final => u.state.(t.next) = u.state.t }
check FinalStaysFinal_New for 3 but 2 Chat, 2 Page, 3 Key, 4 Turn, 8 Time

assert InOrder_New {
    traceNew => all t: Time - last, u: Turn |
        (u.state.t = Queued and u.state.(t.next) = Active)
            => no o: rows[t] | o.chat = u.chat and o.state.t = Queued and lt[o.born, u.born]
}
check InOrder_New for 3 but 2 Chat, 2 Page, 3 Key, 4 Turn, 8 Time

pred RetryThenSaved_New {
    traceNew
    some u: Turn, t1, t2, t3: Time | lt[t1, t2] and lt[t2, t3] and u.state.t1 = Active and u.state.t2 = Queued and u.state.t3 = Saved
}
run RetryThenSaved_New for 3 but 1 Chat, 1 Page, 2 Key, 2 Turn, 8 Time
