---- MODULE JobBoot ----
\* server/node/jobStore.cjs interruptRunning/beat: which running jobs a server marks "interrupted" when it starts (and on each beat).
\* Two server processes can share one jobs.sqlite (a test run started server.cjs with the owner's HOME).
\*   Rule = "All"      : the code before F5: every running job (cut the live server's reply mid-stream)
\*   Rule = "BeatOnly" : a broken fix: only jobs whose boot has not beaten for DEAD ticks (a crash + quick restart leaves orphans)
\*   Rule = "Fixed"    : the code: jobs whose boot is not this one and either stopped beating or whose process is gone (pid check)
EXTENDS Naturals, FiniteSets

CONSTANTS Servers, MaxJobs, MaxBoots, MaxT, BEAT, DEAD, Rule

VARIABLES up, cur, beat, now, owner, jboot, status, boots
vars == <<up, cur, beat, now, owner, jboot, status, boots>>
Jobs == 1..MaxJobs

Init == /\ up = [s \in Servers |-> FALSE] /\ cur = [s \in Servers |-> 0] /\ beat = [b \in 0..MaxBoots |-> 0] /\ now = 0
        /\ owner = [j \in Jobs |-> CHOOSE s \in Servers : TRUE] /\ jboot = [j \in Jobs |-> 0] /\ status = [j \in Jobs |-> "none"] /\ boots = 0

ProcAlive(b) == \E s \in Servers : up[s] /\ cur[s] = b
Dead(b, me) == b # me /\ CASE Rule = "All"      -> TRUE
                          [] Rule = "BeatOnly" -> beat[b] + DEAD < now
                          [] Rule = "Fixed"    -> beat[b] + DEAD < now \/ ~ProcAlive(b)
Interrupt(me) == [j \in Jobs |-> IF status[j] = "running" /\ Dead(jboot[j], me) THEN "interrupted" ELSE status[j]]

Start(s) == /\ ~up[s] /\ boots < MaxBoots
            /\ LET b == boots + 1 IN
               /\ boots' = b /\ up' = [up EXCEPT ![s] = TRUE] /\ cur' = [cur EXCEPT ![s] = b] /\ beat' = [beat EXCEPT ![b] = now]
               /\ status' = [j \in Jobs |-> IF status[j] = "running" /\ jboot[j] # b
                                             /\ (CASE Rule = "All" -> TRUE
                                                  [] Rule = "BeatOnly" -> beat[jboot[j]] + DEAD < now
                                                  [] Rule = "Fixed" -> beat[jboot[j]] + DEAD < now \/ ~(\E x \in Servers : x # s /\ up[x] /\ cur[x] = jboot[j]))
                                             THEN "interrupted" ELSE status[j]]
            /\ UNCHANGED <<now, owner, jboot>>
Crash(s) == /\ up[s] /\ up' = [up EXCEPT ![s] = FALSE] /\ UNCHANGED <<cur, beat, now, owner, jboot, status, boots>>
Create(s, j) == /\ up[s] /\ status[j] = "none" /\ status' = [status EXCEPT ![j] = "running"]
                /\ owner' = [owner EXCEPT ![j] = s] /\ jboot' = [jboot EXCEPT ![j] = cur[s]] /\ UNCHANGED <<up, cur, beat, now, boots>>
Finish(j) == /\ status[j] = "running" /\ up[owner[j]] /\ cur[owner[j]] = jboot[j]
             /\ status' = [status EXCEPT ![j] = "done"] /\ UNCHANGED <<up, cur, beat, now, owner, jboot, boots>>
Beat(s) == /\ up[s] /\ beat' = [beat EXCEPT ![cur[s]] = now] /\ status' = Interrupt(cur[s])
           /\ UNCHANGED <<up, cur, now, owner, jboot, boots>>
\* time passes only while every running server keeps its beat (a live server never looks stale)
Tick == /\ now < MaxT /\ \A s \in Servers : up[s] => beat[cur[s]] + BEAT > now
        /\ now' = now + 1 /\ UNCHANGED <<up, cur, beat, owner, jboot, status, boots>>

Next == Tick \/ \E s \in Servers : Start(s) \/ Crash(s) \/ Beat(s) \/ \E j \in Jobs : Create(s, j) \/ Finish(j)
Spec == Init /\ [][Next]_vars

\* a job whose server is alive (it can still finish it) is never cut
NoLiveCut == [][ \A j \in Jobs : (status[j] = "running" /\ status'[j] = "interrupted") => ~(up[owner[j]] /\ cur[owner[j]] = jboot[j]) ]_vars
\* a server that starts leaves no orphan behind: every running job afterwards has a live process
StartClearsOrphans == [][ \A s \in Servers : Start(s) => \A j \in Jobs : status'[j] = "running" => \E x \in Servers : up'[x] /\ cur'[x] = jboot[j] ]_vars
====
