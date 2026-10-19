% Canon and consistency checks of a Shadow Slave story, over facts exported from story.sqlite (server/node/storyLogic.cjs).
% Run by story/runner.pl, which reads the facts as data (never consults them) and accepts only the predicates declared dynamic here.
%
% Facts (every text is a lower-cased atom):
%   event(Seq, At, Day, Part, Text)  the timeline (led_ev) in order; Day = cal(N) for d/m/yyyy, count(N) for "Day N"/"Ngày N",
%                                    unknown otherwise; Part = 1..8 for dawn..midnight, or unknown
%   event_seen(Seq, Rev)             the save revision at which that timeline line first appeared
%   rank_change(Rev, From, To)       st_rank changed at Rev (normalized: aspirant, sleeper, awakened, ascended, ...)
%   npc(Name)                        a person the ledger knows (relations, memory subjects), not the player
%   mem_slot(Slot, Name)             st_mem<Slot> holds the Memory called Name
%   fragments(X, Cap)                st_frag "X/Cap"
%   cores(C)                         soul cores formed (st_cores "C/..."; 1 when the panel has no cores key)
%
% violation(Rule, Detail):
%   rank_without_event       the Rank changed with no Nightmare or Gateway in the timeline since the previous change (Module 04:
%                            "a full frag counter does not raise the Rank: only a Nightmare does")
%   dead_npc_acts            an NPC the timeline recorded dead is in a later line that is not about the body, a grave or an Echo
%   timeline_backwards       a line is dated before the line before it (same kind of date)
%   memory_in_two_slots      the same Memory in two mem slots
%   fragments_over_capacity  more Soul Fragments than the cores hold (1000 per core formed)
%   fragment_cap_mismatch    the "x/N" counter shows a capacity other than 1000 per core formed
:- dynamic event/5, event_seen/2, rank_change/3, npc/1, mem_slot/2, fragments/2, cores/1.

% ---- words ------------------------------------------------------------------------------------------------------------------------
advance_word('nightmare').
advance_word('ác mộng').
advance_word('gateway').
advance_word('cánh cổng').
advance_word('thử thách đầu tiên').
% "Nightmare Creature" / "Sinh Vật Ác Mộng" is a monster, not a Nightmare
creature_context(T, B, _L) :- B >= 9, B0 is B - 9, sub_atom(T, B0, 9, _, 'sinh vật ').
creature_context(T, B, L) :- E is B + L, sub_atom(T, E, 9, _, ' creature').

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

advance_text(T) :- advance_word(W), sub_atom(T, B, L, _, W), \+ creature_context(T, B, L), !.

% the death word applies to the nearest npc name before it
died_in(T, N) :-
    death_word(W), sub_atom(T, Q, _, _, W),
    npc(N), word_at(T, N, P), P < Q,
    \+ ( npc(M), M \== N, word_at(T, M, P2), P2 > P, P2 < Q ).

% ---- rules ---------------------------------------------------------------------------------------------------------------------
previous_change(Rev, Prev) :-
    findall(R, (rank_change(R, _, _), R < Rev), Rs),
    ( Rs = [] -> Prev = 0 ; max_list(Rs, Prev) ).

violation(rank_without_event, [rev-Rev, from-From, to-To]) :-
    rank_change(Rev, From, To), From \== To,
    previous_change(Rev, Prev),
    \+ ( event_seen(S, R), R > Prev, R =< Rev, event(S, _, _, _, T), advance_text(T) ).

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
violation(timeline_backwards, [earlier-A0, later-A1]) :-
    event(S0, A0, D0, P0, _), S1 is S0 + 1, event(S1, A1, D1, P1, _),
    (   before(D1, D0)
    ;   same_day(D0, D1), integer(P0), integer(P1), P1 < P0 ).

violation(memory_in_two_slots, [memory-N, slot-A, other_slot-B]) :-
    mem_slot(A, N), mem_slot(B, N), A < B.

formed(C) :- cores(C), !.
formed(1).
violation(fragments_over_capacity, [fragments-X, capacity-Max]) :-
    fragments(X, _), formed(C), Max is 1000 * C, X > Max.
violation(fragment_cap_mismatch, [shown-Cap, expected-Max]) :-
    fragments(_, Cap), integer(Cap), formed(C), Max is 1000 * C, Cap =\= Max.
