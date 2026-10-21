% The librarian's Datalog over the knowledge graph (storyGraph.cjs aspFacts). Plain stratified rules, run by clingo; the GM solver may
% load this file beside derive.lp / core.lp (agreed 2026-10-21: names are lower-case NFC strings; dead/1 is derive.lp's input and
% present/1, need/1 are derived there, so this file reads present/1 and defines none of the three).
%
% Facts in (storyGraph.cjs aspFacts):
%   fact(F, S, R, O, St)   fact id, subject, relation (a constant), object (a string, or none), status fact|rumor|unknown|outdated,
%                          already as this chat sees it at now/1: a fact a death or a move ended is outdated
%   knows(P, F, As)        P knows fact F as fact or as rumor ("player" is the player's character)
%   entity(E, Kind)        person | faction | place | item | event
%   present(P)             (derive.lp) in the scene
%
% What follows from what keeps the WEAKEST status of what it rests on: a place inside a rumored territory is only rumored to be
% controlled; nothing is derived from an outdated or unknown fact. So the narrator can be told "derived, rumor" and never states it.

#defined fact/5. #defined knows/3. #defined entity/2. #defined present/1. #defined now/1.

strength(fact, 2). strength(rumor, 1).
weaker(A, B, A) :- strength(A, X), strength(B, Y), X <= Y.
weaker(A, B, B) :- strength(A, X), strength(B, Y), X > Y.

% what the graph says now (outdated and unknown are not holding)
holds(S, R, O, St) :- fact(_, S, R, O, St), strength(St, _).
% enemy_of and ally_of go both ways
holds(O, enemy_of, S, St) :- fact(_, S, enemy_of, O, St), strength(St, _).
holds(O, ally_of, S, St) :- fact(_, S, ally_of, O, St), strength(St, _).

% places inside places
within(X, P, St) :- holds(X, part_of, P, St), entity(X, place).
within(X, P2, St) :- within(X, P1, S1), holds(P1, part_of, P2, S2), weaker(S1, S2, St), X != P2.
% where someone is, up the places it is inside
is_in(X, P, St) :- holds(X, located_at, P, St).
is_in(X, P2, St) :- is_in(X, P1, S1), within(P1, P2, S2), weaker(S1, S2, St).
% who controls a place: directly, or the place is inside one they control
rules(F, P, St) :- holds(F, controls, P, St).
rules(F, P, St) :- rules(F, P1, S1), within(P, P1, S2), weaker(S1, S2, St).
% a faction's people: members and leaders
of_faction(X, F, St) :- holds(X, member_of, F, St).
of_faction(X, F, St) :- holds(X, leads, F, St).
% an enemy of the faction is an enemy of its people (derived, weakest status)
foe(X, Y, St) :- holds(X, enemy_of, Y, St).
foe(X, Y, St) :- of_faction(X, F, S1), holds(F, enemy_of, Y, S2), weaker(S1, S2, St), X != Y.

% the best status a derived relation has (several derivations may give several)
best_rules(F, P, fact) :- rules(F, P, fact).
best_rules(F, P, rumor) :- rules(F, P, rumor), not rules(F, P, fact).
best_in(X, P, fact) :- is_in(X, P, fact).
best_in(X, P, rumor) :- is_in(X, P, rumor), not is_in(X, P, fact).
best_foe(X, Y, fact) :- foe(X, Y, fact).
best_foe(X, Y, rumor) :- foe(X, Y, rumor), not foe(X, Y, fact).

% ---- the librarian's questions ------------------------------------------------------------------------------------------------
% who in this scene knows fact F (and as what)
knows_here(P, F, As) :- present(P), knows(P, F, As).
% who in this scene knows anything about X
knows_about_here(P, X) :- present(P), knows(P, F, _), fact(F, X, _, _, _).
knows_about_here(P, X) :- present(P), knows(P, F, _), fact(F, _, _, X, _).
% what the player has only heard as rumor; what the player does not know though it is true
only_rumor(F) :- knows("player", F, rumor), not knows("player", F, fact).
unaware(F) :- fact(F, _, _, _, fact), not knows("player", F, _), not common(F).
common(F) :- fact(F, _, _, _, _), not known_by_someone(F).
known_by_someone(F) :- knows(P, F, _), P != "player".
% the graph's dead (status dead, a fact); derive.lp's dead/1 stays what the timeline says
graph_dead(P) :- holds(P, status, "dead", fact).
% a person said to be somewhere after their death: the GM must not stage them there
ghost(P, Pl) :- graph_dead(P), holds(P, located_at, Pl, _).

#show knows_here/3. #show knows_about_here/2. #show only_rumor/1. #show unaware/1.
#show best_rules/3. #show best_in/3. #show best_foe/3. #show graph_dead/1. #show ghost/2.
