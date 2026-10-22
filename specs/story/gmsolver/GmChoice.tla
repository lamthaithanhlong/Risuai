---------------------------- MODULE GmChoice ----------------------------
\* The Game Master's choice of a turn (server/node/gmSolver.cjs + story/gm/*.lp), against the prompt-only GM it replaces.
\* Each turn the story moves (a need is stated or met, people come, go or die), then a choice is made: one event (new or not) and
\* what one person does (an offer or a lure on a need, or acting in the scene).
\*   Mode "prompt"   the note only asks (gameMaster.ts NEED_RULE, "at most one new trouble"): the model may choose anything.
\*   Mode "solver"   the choice is an answer set of core.lp: offers only on an established need, actors only present and alive,
\*                   no new event right after one.
\*   Mode "fallback" the solver, but a turn may get no answer (no clingo, past the 300 ms budget): that turn has today's note.
\* Measured 2026-10-21 (Shadow Slave chat ee04f566): a stranger offered water to a character nobody had shown thirsty.
\* The invariants are about the CHOICE handed to the narrator; that the narration follows it is measured by the acceptance run.
EXTENDS Naturals, FiniteSets
CONSTANTS Mode, People, Needs, MaxTurn
VARIABLES needs, present, dead, away, prevNew, wasNew, turn, choice, solved
vars == <<needs, present, dead, away, prevNew, wasNew, turn, choice, solved>>

None == "none"
Kinds == {"offer", "act", "quiet"}
Choices == [kind : Kinds, who : People \cup {None}, need : Needs \cup {None}, new : BOOLEAN]

Init == needs = {} /\ present = {} /\ dead = {} /\ away = {} /\ prevNew = FALSE /\ wasNew = FALSE /\ turn = 0
        /\ choice = [kind |-> "quiet", who |-> None, need |-> None, new |-> FALSE] /\ solved = TRUE

\* what core.lp allows (opt/2 and the hard constraints NEED, PRESENCE, DEATH, PACING)
Valid(c, n, p, d, pn) ==
    /\ (c.kind = "offer") => (c.need \in n /\ c.who \in p \ d)
    /\ (c.kind = "act") => (c.who \in p \ d)
    /\ (c.kind = "quiet") => (c.who = None /\ c.need = None)
    /\ (c.kind # "offer") => c.need = None
    /\ (pn => ~c.new)
Shaped(c) == /\ (c.kind = "offer") => (c.who # None /\ c.need # None)
             /\ (c.kind = "act") => c.who # None /\ c.need = None
             /\ (c.kind = "quiet") => c.who = None /\ c.need = None

Turn ==
    /\ turn < MaxTurn
    /\ \E n \in SUBSET Needs, p \in SUBSET People, d \in SUBSET People, a \in SUBSET People, ok \in BOOLEAN, c \in Choices :
        /\ dead \subseteq d                         \* the dead stay dead
        \* derive.lp away/1 (2026-10-22, Mailman: Mặt Sẹo "biến mất" in two replies, still present, then he spoke): a person whose newest
        \* mention says they left, with no return and no call by the player, is not in the scene however recently named
        /\ (Mode # "prompt" /\ ok) => (a \cap p = {})
        /\ Shaped(c)
        /\ (Mode = "solver" => ok) /\ (Mode = "prompt" => ~ok)  \* "fallback": a turn may or may not get an answer
        /\ (Mode # "prompt" /\ ok) => Valid(c, n, p, d, prevNew)
        /\ needs' = n /\ present' = p /\ dead' = d /\ away' = a /\ choice' = c /\ solved' = (Mode # "prompt" /\ ok)
        /\ prevNew' = c.new /\ wasNew' = prevNew
        /\ turn' = turn + 1

Spec == Init /\ [][Turn]_vars

\* the choice of the latest turn, against the story as it stood when it was made
NoInventedNeed == choice.kind = "offer" => choice.need \in needs
NoAbsentActor == choice.kind # "quiet" => choice.who \in present
NoDeadActor == choice.kind # "quiet" => choice.who \notin dead
NoLeftActor == choice.kind # "quiet" => choice.who \notin away
NoNewTwice == ~(wasNew /\ choice.new)
=============================================================================
