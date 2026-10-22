% The Game Master's Datalog: what the story has ESTABLISHED before a turn. Plain stratified rules, evaluated by clingo in the same
% run as the choice (story/gm/core.lp), so a turn costs one process. Reading the words (a need said in Vietnamese or English, negated
% or not; a name in a message; a death in the timeline) is done in JS (server/node/gmSolver.cjs), which writes the facts below.
%
% Why (measured 2026-10-21, Shadow Slave chat ee04f566): after the player only walked on, a stranger offered "I'll show you where
% the water is", though nobody had shown the character thirsty. Here a need is a fact or it is not; core.lp hooks an offer only on
% a need derived here.
% (2026-10-21, "cân nhắc lại Datalog nếu nó thật sự phù hợp": a first version ran these rules in SWI-Prolog as a second process
% before clingo. What the choice needs is a few non-recursive rules over facts that are really word matching, so the rules moved
% here and the words to JS: one process instead of two, a turn's solve 74 -> 29 ms median, 156 -> 30 ms p90, same answers.)
%
% Facts in:
%   panel_need(N)        the panel's condition names need N (thirst, hunger, wound, exhausted, cold, sick, lost, money, shelter)
%   said_need(N, I)      message I (0 = the player's message this turn, 1 = the reply before it, ...) says the character has N
%   resolved(N, I)       message I says N was met (drank, ate, bandaged, rested)
%   person(P)            a person the story knows (the ledger's NPCs, the GM's enemies, antagonist and threats)
%   named(P, I)          message I names P;   seen_here(P): the ledger last saw P at the player's place
%   left(P, I)           reply I says P walked off / vanished (narration, not speech, not negated, same sentence as the name)
%   returned(P, I)       reply I says P came back
%   dead(P)              the timeline says P died (storyStore.cjs DEATH, the same words as canon.pl's death_word)
%   thread(T, Kind), actor(T, P)
% Derived:
%   need(N)      established: on the panel, or said in the last 4 messages and not met after
%   present(P)   in the scene: named in the player's message or the last reply, or named lately and last seen here; never dead
%   away(P)      the newest message that names P says P left, and no return at or after it: not in the scene, however recently named
%                (measured 2026-10-22, Mailman: two replies said Mặt Sẹo was gone, the names kept him "present", the third made him speak)
%   open(T)      the thread can still move: none of its actors is dead
#defined panel_need/1. #defined said_need/2. #defined resolved/2. #defined person/1. #defined named/2. #defined seen_here/1.
#defined left/2. #defined returned/2.
#defined dead/1. #defined thread/2. #defined actor/2. #defined graph_dead/1.

% the librarian's graph (story/gm/graph.lp, loaded beside this file when the chat has one) knows deaths the timeline may not
dead(P) :- graph_dead(P), person(P).

need(N) :- panel_need(N).
need(N) :- said_need(N, I), I <= 3, not met_after(N, I).
met_after(N, I) :- said_need(N, I), resolved(N, J), J < I.

% the newest message naming P is a reply that says P left, and nothing at or after it brings P back; message 0 (the player calling
% P) is never a leave, so naming P in the player's message ends it
newer(P, I) :- named(P, J), named(P, I), J < I.
back(P, I) :- returned(P, J), left(P, I), J <= I.
away(P) :- person(P), left(P, I), I >= 1, not newer(P, I), not back(P, I).

present(P) :- person(P), not dead(P), not away(P), named(P, I), I <= 1.
present(P) :- person(P), not dead(P), not away(P), seen_here(P), named(P, I), I <= 3.

closed(T) :- actor(T, P), dead(P).
open(T) :- thread(T, _), not closed(T).

#show need/1.
#show present/1.
#show away/1.
#show dead/1.
