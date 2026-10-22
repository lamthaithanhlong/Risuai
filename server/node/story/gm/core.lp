% The Game Master's choice for one turn (clingo), for every world; the world's own kinds and rules are in story/gm/<world>.lp.
% Run by server/node/gmSolver.cjs before the narrator's request: the facts are the app's dice for this turn and what the Datalog
% (story/gm/derive.pl) derived from the chat. The answer is ONE turn event and one intent for each person in the scene; the GM note
% hands the narrator that decision instead of open rules (gameMaster.ts gmNote).
%
% Facts in:
%   phase(seed|run)            the GM's phase (gameMaster.ts gmPhase)
%   pace(quiet|build|advance|escalate)   the app's pace die (rollGm)
%   card_new                   the card's own fate die said NEW at a pause (cardEvent)
%   prev_new                   the last reply was asked for a new event (an advance, an escalation, the card's NEW, a first order)
%   consequence_roll           the app's die says a due consequence lands now;  due(C): consequence C is due
%   first_order                a side was just taken: its first order or test comes due;  side(T): the side's thread
%   thread(T, Kind)            an open thread of the GM (open(T) from the Datalog: none of its actors is dead)
%   arc(T)                     T belongs to the arc (antagonist, goal, threat);   focus(T): the thread the app's dice put in focus
%   side_focus(T)              the side was taken in the last few replies: it is the focus
%   actor(T, P), present(P), dead(P), need(N), open(T)   (story/gm/derive.lp derives need, present and open in the same run)
%   hostile_thread(T)          T is the antagonist, a threat or an enemy: its actors are hostile
%   combat(peace|fight|aftermath), scene(still|travel|rest)   the GM machine's state (gmMachine.ts, XState)
%   rolled(K)                  the card's Kind die (kind_text matched);  stance(S): the card's stance die
%   done_before                the story has a past (timeline lines, a past arc or a due consequence)
%   where(W)                   where the player is, for a world whose kinds depend on it (reality / a delivery world, base / city)
%
% Answer out: turn(E), acts(E, P), onstage(P) / offstage(P), approach(P), intent(P, I)

% inputs that a turn may leave out
#defined phase/1. #defined pace/1. #defined card_new/0. #defined prev_new/0. #defined consequence_roll/0. #defined due/1.
#defined first_order/0. #defined side/1. #defined side_focus/1. #defined thread/2. #defined open/1. #defined arc/1. #defined focus/1.
#defined actor/2. #defined present/1. #defined dead/1. #defined need/1. #defined hostile/1. #defined rolled_text/1. #defined stance/1.
#defined done_before/0. #defined where/1. #defined kind_where/2. #defined no_chase/0. #defined kind/2. #defined kind_text/2.
#defined hostile_thread/1. #defined companion/1. #defined combat/1. #defined scene/1. #defined knows_here/3. #defined knows/3.

% the people a hostile thread (antagonist, threat, enemy) is about oppose the player
hostile(P) :- actor(T, P), hostile_thread(T).

% ---- candidates -------------------------------------------------------------------------------------------------------------------
cand(quiet).
cand(seed) :- phase(seed).
cand(build(T)) :- open(T).
cand(advance(T)) :- open(T).
cand(escalate(T)) :- open(T).
cand(new(K)) :- card_new, kind(K, _), kind_here(K).
cand(land(C)) :- due(C), consequence_roll.
cand(order(T)) :- side(T), first_order.

kind_here(K) :- kind(K, _), not kind_where(K, _).
kind_here(K) :- kind_where(K, W), where(W).

thread_of(build(T), T) :- cand(build(T)).
thread_of(advance(T), T) :- cand(advance(T)).
thread_of(escalate(T), T) :- cand(escalate(T)).
thread_of(order(T), T) :- cand(order(T)).

newish(advance(T)) :- cand(advance(T)).
newish(escalate(T)) :- cand(escalate(T)).
newish(new(K)) :- cand(new(K)).
newish(order(T)) :- cand(order(T)).

1 { turn(E) : cand(E) } 1.

% ---- what the dice allow --------------------------------------------------------------------------------------------------------
allowed(seed) :- phase(seed).
allowed(quiet).
allowed(build(T)) :- pace(build), cand(build(T)).
allowed(advance(T)) :- pace(advance), cand(advance(T)).
allowed(escalate(T)) :- pace(escalate), cand(escalate(T)).
% a pace that would bring a new event right after one builds instead
allowed(build(T)) :- prev_new, pace(advance), cand(build(T)).
allowed(build(T)) :- prev_new, pace(escalate), cand(build(T)).
allowed(new(K)) :- cand(new(K)).
allowed(land(C)) :- cand(land(C)).
allowed(order(T)) :- cand(order(T)).
:- turn(E), not allowed(E).
:- phase(seed), turn(E), E != seed.
:- phase(run), turn(seed).

% PACING: never a new event two turns running (the cards' Module 10, "Never two new events in a row")
:- prev_new, turn(E), newish(E).

% COMBAT (the GM machine): a fight is no natural pause, so nothing new surfaces in it; an enemy in the fight opposes the player
:- combat(fight), turn(new(_)).
:- combat(fight), intent(P, I), hostile(P), I != oppose.

% ---- who acts -----------------------------------------------------------------------------------------------------------------------
acts(E, P) :- turn(E), thread_of(E, T), actor(T, P).
onstage(P) :- acts(_, P), present(P).
offstage(P) :- acts(_, P), not present(P).
% CANON / DEATH: a dead person never acts (open/1 already leaves out their threads; this is the rule itself)
:- acts(_, P), dead(P).
% an absent hostile actor whose move is due comes closer off-stage (a plan, gmSolver.cjs), unless the world says hooks never chase
approach(P) :- offstage(P), hostile(P), not no_chase.

% ---- intents of the people in the scene ---------------------------------------------------------------------------------------------
role(P) :- present(P).
role(newcomer) :- turn(new(K)), kind(K, person).
some_need :- need(_).

opt(P, oppose) :- role(P), hostile(P).
opt(P, own) :- role(P).
opt(P, watch) :- role(P).
opt(P, help) :- role(P), not hostile(P).
opt(P, ask_help) :- role(P), not hostile(P).
opt(P, offer(N)) :- role(P), need(N), not hostile(P).
opt(P, lure(N)) :- role(P), need(N).
% the librarian's graph (graph.lp): someone in the scene may share a fact they know that the player does not know as true
news(F) :- knows_here(_, F, _), not knows("player", F, fact).
opt(P, tell(F)) :- role(P), P != newcomer, not hostile(P), knows_here(P, F, _), news(F).
1 { intent(P, I) : opt(P, I) } 1 :- role(P).

% NEED: an NPC's offer, bait or bargain targets only a need the story established (derive.pl)
:- intent(_, offer(N)), not need(N).
:- intent(_, lure(N)), not need(N).
% PRESENCE: only someone in the scene (or the card's newcomer) acts in it; never a dead one
:- intent(P, _), P != newcomer, not present(P).
:- intent(P, _), dead(P).
% KNOWLEDGE: a person tells only what they know (graph.lp knows_here), and one person shares news in a turn at most
:- intent(P, tell(F)), not knows_here(P, F, _).
:- #count { P : intent(P, tell(_)) } > 1.

% the newcomer acts as the card's stance die says
fits(oppose) :- stance(hostile).
fits(watch) :- stance(wary).
fits(watch) :- stance(frightened).
fits(own) :- stance(indifferent).
fits(own) :- stance(hiding).
fits(ask_help) :- stance(needs_help).
fits(lure(N)) :- stance(wants_to_use), need(N).
fits(own) :- stance(wants_to_use), not some_need.
fits(help) :- stance(friendly).
fits(offer(N)) :- stance(friendly), need(N).
fits(own) :- not stance(_).

% ---- preferences ----------------------------------------------------------------------------------------------------------------
% the card's NEW, when it may come, comes; then a due consequence the app's die landed
took_new :- turn(new(_)).
:~ card_new, not prev_new, not took_new, cand(new(_)). [1@6]
took_land :- turn(land(_)).
:~ consequence_roll, cand(land(_)), not took_land, not took_new. [1@5]
% a side just taken drives the story
:~ side_focus(T), turn(E), not thread_of(E, T), not took_new, not took_land. [1@4]
% quiet only when the pace is quiet or nothing else may come
:~ turn(quiet), pace(P), P != quiet. [1@4]
% continuity with the GM's arc
:~ turn(E), thread_of(E, T), not arc(T), not side(T). [1@3]
% the dice: the kind the card rolled, the thread the app's dice put in focus
:~ turn(new(K)), not rolled(K). [1@2]
:~ turn(E), thread_of(E, T), not focus(T). [1@1]
% people: an enemy opposes; the others live their own lives; the newcomer fits the card's stance
:~ intent(P, I), hostile(P), I != oppose. [1@3, P]
:~ intent(newcomer, I), not fits(I). [1@3]
% help is a cost for most people, but the player's persona's companion (npc.lp companion/1) is there to help: their own business costs instead
:~ intent(P, help), P != newcomer, not companion(P). [1@1, P]
:~ intent(P, own), companion(P). [1@1, P]
:~ intent(P, ask_help), P != newcomer. [2@1, P]
:~ intent(P, watch), not hostile(P). [1@1, P]
:~ intent(P, offer(N)), P != newcomer. [1@1, P, N]
:~ intent(P, lure(N)), not hostile(P), P != newcomer. [3@1, P, N]
% news is shared on a quiet turn (the player's choice plays out, people talk); on a turn with an event people keep to their business
some_tell :- intent(_, tell(_)).
news_here :- opt(_, tell(_)).
:~ pace(quiet), news_here, not some_tell. [1@1]
:~ intent(P, tell(F)), not pace(quiet). [1@1, P, F]

#show turn/1.
#show acts/2.
#show onstage/1.
#show offstage/1.
#show approach/1.
#show intent/2.
#show hostile/1.
#show knows_here/3.

% ---- kinds (the world file lists them) --------------------------------------------------------------------------------------------
rolled(K) :- kind_text(K, T), rolled_text(T).
% the price of something done before needs something done before
:- turn(new(K)), kind(K, price), not done_before.
% a canon figure is only seen from afar: nobody new in the scene with them
canon_afar :- turn(new(K)), kind(K, canon).
