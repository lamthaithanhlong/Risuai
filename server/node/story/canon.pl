% Generic canon and consistency checks of a story, over facts exported from story.sqlite (server/node/storyLogic.cjs). They hold in
% every world; what a world adds (its advancement words, its own rules) is in story/worlds/<world>.pl, loaded after this file.
% Which world a chat plays is picked from its card by storyWorlds.cjs (the card name, its lore titles, the st_* keys its panel uses).
% Run by story/runner.pl, which reads the facts as data (never consults them) and accepts only the predicates declared dynamic.
%
% Facts (every text is a lower-cased atom):
%   event(Seq, At, Day, Part, Text)  the timeline (led_ev) in order; Day = cal(N) for d/m/yyyy, count(N) for "Day N"/"Ngày N",
%                                    unknown otherwise; Part = 1..8 for dawn..midnight, or unknown
%   event_seen(Seq, Rev)             the save revision at which that timeline line first appeared
%   rank_change(Rev, From, To)       the world's rank key changed at Rev (normalized by the world profile: sleeper, seq8, low, ...)
%   rank_level(Rank, N)              the world's rank order, from its profile (code, not chat data): higher N = higher rank
%   npc(Name)                        a person the ledger knows (relations, memory subjects), not the player
%   slot(Group, Slot, Name)          slot <Slot> of a slot group (memory, stamp, item, artifact) holds the thing called Name
%
% violation(Rule, Detail), generic:
%   rank_without_event   the rank changed with no advancement event of the world in the timeline since the previous change
%   rank_skipped         the rank rose more than one step at once
%   rank_lowered         the rank went down (no world here has a way back down)
%   dead_npc_acts        an NPC the timeline recorded dead is in a later line that is not about the body, a grave or an Echo
%   timeline_backwards   a line is dated before the line before it (same kind of date)
%   <Group>_in_two_slots the same thing in two slots of one group (memory_in_two_slots, stamp_in_two_slots, ...)
%
% World hooks (multifile, defined by story/worlds/*.pl; none defined = the generic rule has nothing to accept):
%   advance_word(W)        a timeline word that is an advancement event to any rank
%   advance_to(Rank, W)    a word that is an advancement event to that rank only
%   advance_exclude(T,B,L) the match of length L at B in T is not one (e.g. "Nightmare Creature")
%   remains_word(W)        more words that make a later mention of a dead NPC not an act
%   rank_can_fall          the world allows a rank to go down
%
% Every violation clause below is preceded by a "% rule: <name>" line and followed by a blank line: the tests remove a rule by
% that marker and check that its red case goes silent.
:- dynamic event/5, event_seen/2, rank_change/3, rank_level/2, npc/1, slot/3.
:- multifile violation/2, advance_word/1, advance_to/2, advance_exclude/3, remains_word/1, rank_can_fall/0.
:- discontiguous violation/2.

% ---- words ------------------------------------------------------------------------------------------------------------------------
death_word('died').
death_word('dies').
death_word('is dead').
death_word('was killed').
death_word('were killed').
death_word('was slain').
death_word('perished').
death_word('chết').
death_word('tử trận').
death_word('tử vong').
death_word('bị giết').
death_word('qua đời').
death_word('hy sinh').

% a later mention that is not the dead person acting
remains_word('corpse').
remains_word('body').
remains_word('grave').
remains_word('funeral').
remains_word('buried').
remains_word('bury').
remains_word('buries').
remains_word('echo').
remains_word('memorial').
remains_word('remember').
remains_word('xác').
remains_word('thi thể').
remains_word('mộ').
remains_word('tang').
remains_word('chôn').
remains_word('tiếng vọng').
remains_word('tưởng nhớ').
remains_word('nhớ về').

% ---- text helpers ------------------------------------------------------------------------------------------------------------------
letter(C) :- char_type(C, alnum).
word_at(T, W, B) :-
    sub_atom(T, B, L, _, W),
    (   B =:= 0 -> true ; B1 is B - 1, sub_atom(T, B1, 1, _, C1), \+ letter(C1) ),
    E is B + L,
    (   atom_length(T, E) -> true ; sub_atom(T, E, 1, _, C2), \+ letter(C2) ).
mentions(T, N) :- word_at(T, N, _), !.

advancement_word(_, W) :- advance_word(W).
advancement_word(To, W) :- advance_to(To, W).
advance_text(T, To) :- advancement_word(To, W), sub_atom(T, B, L, _, W), \+ advance_exclude(T, B, L), !.

% the death word applies to the nearest npc name before it
died_in(T, N) :-
    death_word(W), sub_atom(T, Q, _, _, W),
    npc(N), word_at(T, N, P), P < Q,
    \+ ( npc(M), M \== N, word_at(T, M, P2), P2 > P, P2 < Q ).

previous_change(Rev, Prev) :-
    findall(R, (rank_change(R, _, _), R < Rev), Rs),
    ( Rs = [] -> Prev = 0 ; max_list(Rs, Prev) ).

% a timeline line that first appeared after the previous rank change and no later than this one
event_between(Prev, Rev, T) :- event_seen(S, R), R > Prev, R =< Rev, event(S, _, _, _, T).

% ---- rules ---------------------------------------------------------------------------------------------------------------------
% rule: rank_without_event
violation(rank_without_event, [rev-Rev, from-From, to-To]) :-
    rank_change(Rev, From, To), From \== To,
    previous_change(Rev, Prev),
    \+ ( event_between(Prev, Rev, T), advance_text(T, To) ).

% rule: rank_skipped
violation(rank_skipped, [rev-Rev, from-From, to-To]) :-
    rank_change(Rev, From, To), rank_level(From, A), rank_level(To, B), B > A + 1.

% rule: rank_lowered
violation(rank_lowered, [rev-Rev, from-From, to-To]) :-
    \+ rank_can_fall,
    rank_change(Rev, From, To), rank_level(From, A), rank_level(To, B), B < A.

% rule: dead_npc_acts
violation(dead_npc_acts, [npc-N, died_at-A1, acts_at-A2, line-T2]) :-
    npc(N),
    event(S1, A1, _, _, T1), died_in(T1, N),
    event(S2, A2, _, _, T2), S2 > S1,
    mentions(T2, N),
    \+ died_in(T2, N),
    \+ ( remains_word(W), sub_atom(T2, _, _, _, W) ).

before(cal(A), cal(B)) :- A < B.
before(count(A), count(B)) :- A < B.
same_day(cal(A), cal(A)).
same_day(count(A), count(A)).
% rule: timeline_backwards
violation(timeline_backwards, [earlier-A0, later-A1]) :-
    event(S0, A0, D0, P0, _), S1 is S0 + 1, event(S1, A1, D1, P1, _),
    (   before(D1, D0)
    ;   same_day(D0, D1), integer(P0), integer(P1), P1 < P0 ).

% rule: in_two_slots
violation(Rule, [Group-N, slot-A, other_slot-B]) :-
    slot(Group, A, N), slot(Group, B, N), A < B,
    atom_concat(Group, '_in_two_slots', Rule).
