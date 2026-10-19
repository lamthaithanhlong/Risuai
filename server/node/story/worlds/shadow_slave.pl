% Shadow Slave (fate-simulator Module 04 Progression, Module 07 Status panel). Loaded after story/canon.pl.
%
% Facts:
%   fragments(X, Cap)   st_frag "X/Cap"
%   cores(C)            soul cores formed (st_cores "C/..."; 1 when the panel has no cores key)
%
% violation(Rule, Detail):
%   fragments_over_capacity  more Soul Fragments than the cores hold (1000 per core formed)
%   fragment_cap_mismatch    the "x/N" counter shows a capacity other than 1000 per core formed
% The advancement events (Module 04: "a full frag counter does not raise the Rank: only a Nightmare does"; a Gateway makes a
% Sleeper Awakened) are advance_word/1 below; "Nightmare Creature" / "Sinh Vật Ác Mộng" is a monster, not a Nightmare.
:- dynamic fragments/2, cores/1.
:- multifile violation/2, advance_word/1, advance_to/2, advance_exclude/3, remains_word/1, rank_can_fall/0.
:- discontiguous violation/2.

advance_word('nightmare').
advance_word('ác mộng').
advance_word('gateway').
advance_word('cánh cổng').
advance_word('thử thách đầu tiên').
advance_exclude(T, B, _L) :- B >= 9, B0 is B - 9, sub_atom(T, B0, 9, _, 'sinh vật ').
advance_exclude(T, B, L) :- E is B + L, sub_atom(T, E, 9, _, ' creature').

formed(C) :- cores(C), !.
formed(1).
% rule: fragments_over_capacity
violation(fragments_over_capacity, [fragments-X, capacity-Max]) :-
    fragments(X, _), formed(C), Max is 1000 * C, X > Max.

% rule: fragment_cap_mismatch
violation(fragment_cap_mismatch, [shown-Cap, expected-Max]) :-
    fragments(_, Cap), integer(Cap), formed(C), Max is 1000 * C, Cap =\= Max.
