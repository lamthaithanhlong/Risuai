% Lord of the Mysteries (fate-simulator Module 03 Pathway and Potion, Module 04 Progression, Module 07 Status panel; lore
% "Pathways and Sequences", "Beyonder potions and digestion", canon card "Sealed artifacts: grades and storage"). Loaded after
% story/canon.pl. The rank is the Sequence: ordinary, seq9 (the first potion) .. seq0, one level per step (rank_level from the
% profile), so canon.pl's rank_skipped / rank_lowered already say "one Sequence at a time, never back".
%
% Facts:
%   pathway_change(Rev, From, To)   st_pathway changed at Rev (normalized: fool, door, visionary, ...)
%   digestion_before(Rev, State)    the potion's digestion just before Rev: not_started, in_progress, close, complete, unknown
%   potion_changed(Rev)             st_potion was written at Rev
%   control_changed(Rev)            st_control was written at Rev
%   artifact_grade(Slot, Grade)     st_artifact<Slot> is a sealed artifact of that grade (0..3)
%   ability_seq(Slot, Name, N)      st_ability<Slot> comes from Sequence N
%   seq_now(N)                      the character's Sequence now (10 = ordinary person)
%
% violation(Rule, Detail):
%   early_advance_unmarked   the next potion was drunk before the current one was digested, and the same write did not record the
%                            loss-of-control risk in st_control. Drinking early is possible in the novel (Dunn advanced twice
%                            undigested, B1 Ch154; the Craftsman reached Sequence 0 undigested and had to fight madness, B1 Ch1826),
%                            so the advance stands; what it may not do is come without its cost.
%   seq_without_new_potion   the Sequence rose and the same write did not set the new potion's digestion (Module 07)
%   pathway_changed          the Pathway changed to one that is not its neighbour, or not by drinking the next Sequence's potion
%                            ("drinking a potion from a different Pathway causes loss of control"; only neighbouring Pathways,
%                            the groups below, exchange)
%   grade0_artifact_carried  a grade-0 sealed artifact in the character's hands (grade 0 is sealed only under the Holy Cathedral)
%   ability_above_sequence   an ability from a stronger Sequence than the character's (Module 03: never a higher Sequence's ability)
:- dynamic pathway_change/3, digestion_before/2, potion_changed/1, control_changed/1, artifact_grade/2, ability_seq/3, seq_now/1.
:- multifile violation/2, advance_word/1, advance_to/2, advance_exclude/3, remains_word/1, rank_can_fall/0.
:- discontiguous violation/2.

% drinking the potion is the only advancement (Module 04: training, a won fight or money never replace it); in the Silver City a
% Beyonder may swallow the characteristic itself (canon card, B1 Ch1303)
advance_word('uống ma dược').
advance_word('uống lọ ma dược').
advance_word('uống xong ma dược').
advance_word('uống cạn ma dược').
advance_word('nuốt đặc tính').
advance_word('drank the potion').
advance_word('drinks the potion').
advance_word('drink the potion').
advance_word('drank a potion').
advance_word('drank the beyonder potion').
advance_word('swallowed the characteristic').
advance_word('swallows the characteristic').
% "chưa uống ma dược", "không uống ma dược", "did not drink the potion"
advance_exclude(T, B, _) :- member(N, ['chưa ', 'không ', 'chẳng ', 'chuẩn bị ', 'not ', 'n\'t ']), atom_length(N, NL), B >= NL, B0 is B - NL, sub_atom(T, B0, NL, _, N).

% the neighbouring Pathways of the novel (the groups that share a source)
pathway_group(lord_of_mysteries, [fool, error, door]).
pathway_group(god_almighty, [visionary, sun, tyrant, white_tower, hanged_man]).
pathway_group(eternal_darkness, [darkness, death, twilight_giant]).
pathway_group(calamity, [demoness, red_priest]).
pathway_group(fallen, [abyss, chained]).
pathway_group(earth, [mother, moon]).
pathway_group(order, [black_emperor, justiciar]).
pathway_group(knowledge, [hermit, paragon]).
pathway_group(fate, [wheel_of_fortune]).
neighbours(A, B) :- pathway_group(_, Ps), memberchk(A, Ps), memberchk(B, Ps), A \== B.
one_step(Rev) :- rank_change(Rev, F, T), rank_level(F, A), rank_level(T, B), B =:= A + 1.
rose(Rev, From, To) :- rank_change(Rev, From, To), rank_level(From, A), rank_level(To, B), B > A.

% rule: early_advance_unmarked
violation(early_advance_unmarked, [rev-Rev, from-From, to-To, digestion-S]) :-
    rose(Rev, From, To), From \== ordinary,
    digestion_before(Rev, S), S \== complete, S \== unknown,
    \+ control_changed(Rev).

% rule: seq_without_new_potion
violation(seq_without_new_potion, [rev-Rev, from-From, to-To]) :-
    rose(Rev, From, To), \+ potion_changed(Rev).

% rule: pathway_changed
violation(pathway_changed, [rev-Rev, from-From, to-To, reason-not_neighbour]) :-
    pathway_change(Rev, From, To), From \== To, \+ neighbours(From, To).
violation(pathway_changed, [rev-Rev, from-From, to-To, reason-not_with_next_potion]) :-
    pathway_change(Rev, From, To), From \== To, neighbours(From, To), \+ one_step(Rev).

% rule: grade0_artifact_carried
violation(grade0_artifact_carried, [slot-I, artifact-N]) :-
    artifact_grade(I, 0), slot(artifact, I, N).

% rule: ability_above_sequence
violation(ability_above_sequence, [slot-I, ability-N, ability_seq-AS, seq-S]) :-
    ability_seq(I, N, AS), seq_now(S), AS < S.
