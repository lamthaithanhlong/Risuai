% The people in the scene as people (clingo), loaded by server/node/gmSolver.cjs beside core.lp only when story/npcs/<world>.json gave
% at least one present person a profile (npcPsych.cjs aspFacts). core.lp decides the turn event and each person's INTENT (what the
% story needs from them); this file decides each person's SOCIAL ACT toward the player (what they feel like doing) under hard rules
% about trust, grudge and secrets, and derives the tone the narrator shows it in. One decision layer: the same clingo run, the same
% names (lower-case NFC strings, the ledger's own, as core.lp's present/1).
%
% Facts in (npcPsych.cjs aspFacts; every number 0..100 unless said):
%   npc(P)                P is in the scene (present/1) and has a profile
%   trait(P, open|consc|extra|agree|neuro, V)         the Big Five
%   rel(P, Q, trust|affection|debt|grudge, V)         how P sees Q ("player" or another person in the scene)
%   emotion(P, E, I)      what P feels now (OCC type E, intensity I 1..10)
%   mood(P, M)            -10..10;   si(P, Q, V)  social importance of Q to P, 0..10 (optional: only the FAtiMA engine gives it)
%   companion(P)          P is the player's persona's companion (no card profile: npcPsych.cjs companionOf)
%   has_secret(P), has_agenda(P)    booleans: the TEXT of a secret or an agenda never reaches clingo or the narrator
%   recent(P, Tag, Q)     an act of the last 3 turns that touched a person in the scene
% Answer out: social_action(P, A), demeanor(P, D), wants(P, A), may_silent(P)
%
% HARD rules say what a person never does; SOFT rules (level 2, below core.lp's level 3 on the arc, above its level 1 dice) say what they
% would rather do. Every hard rule has a test that takes it out and finds the bad answer valid (gmSolver.test.ts).

#defined npc/1. #defined trait/3. #defined rel/4. #defined emotion/3. #defined mood/2. #defined si/3. #defined has_secret/1. #defined has_agenda/1.
#defined recent/3. #defined companion/1. #defined intent/2. #defined hostile/1. #defined present/1.

act(small_talk;reconcile;refuse;keep_distance;insult;flirt;confide;threaten;help;conceal_affection;forgive).
sopt(P, A) :- npc(P), present(P), act(A).
1 { social_action(P, A) : sopt(P, A) } 1 :- npc(P), present(P).

% ---- HARD -----------------------------------------------------------------------------------------------------------------------------
% SECRET: below trust 30 nothing is volunteered (opening up, or telling what they know when they hold something back); even above it a
% hidden secret needs trust 60
:- social_action(P, confide), rel(P, "player", trust, V), V < 30.
:- intent(P, tell(_)), has_secret(P), rel(P, "player", trust, V), V < 30.
:- social_action(P, confide), has_secret(P), rel(P, "player", trust, V), V < 60.
% an actor of a hostile thread does not help; the act agrees with the intent core.lp gave the same person
:- social_action(P, help), hostile(P).
:- social_action(P, help), intent(P, oppose).
:- social_action(P, insult), intent(P, help).
:- social_action(P, threaten), intent(P, help).
% affection is what flirting rests on
:- social_action(P, flirt), rel(P, "player", affection, V), V < 50.
% GRUDGE: a deep one is neither settled nor forgiven in a turn, and nobody makes peace the turn after being betrayed
:- social_action(P, reconcile), rel(P, "player", grudge, G), G >= 70.
:- social_action(P, forgive), rel(P, "player", grudge, G), G >= 70.
:- social_action(P, reconcile), recent(_, betray, P).
:- social_action(P, forgive), recent(_, betray, P).

% ---- volitions (deterministic: what they feel like doing) ------------------------------------------------------------------------------
wants(P, reconcile)    :- rel(P, "player", affection, A), A >= 50, rel(P, "player", grudge, G), G >= 20, G < 70.
wants(P, keep_distance):- rel(P, "player", trust, T), T < 40.
wants(P, keep_distance):- emotion(P, fear, I), I >= 4.
wants(P, refuse)       :- rel(P, "player", grudge, G), G >= 40.
wants(P, insult)       :- emotion(P, anger, I), I >= 6, trait(P, agree, A), A < 40.
wants(P, threaten)     :- hostile(P).
wants(P, threaten)     :- rel(P, "player", grudge, G), G >= 60, trait(P, agree, A), A < 30.
wants(P, help)         :- rel(P, "player", debt, D), D >= 40, not hostile(P).
wants(P, help)         :- emotion(P, gratitude, I), I >= 4, not hostile(P).
% the persona's companion is at the player's side to help (Mailman 2026-10-22: as a stranger, Evelyn made small talk through a bear chase)
wants(P, help)         :- companion(P), not hostile(P).
wants(P, confide)      :- rel(P, "player", trust, T), T >= 60, has_agenda(P).
wants(P, flirt)        :- rel(P, "player", affection, A), A >= 65, emotion(P, love, _).
% caring but guarded: a person who loves the player yet does not trust them yet, or is simply reserved, hides it
wants(P, conceal_affection) :- rel(P, "player", affection, A), A >= 60, rel(P, "player", trust, T), T < 50.
wants(P, conceal_affection) :- rel(P, "player", affection, A), A >= 60, trait(P, extra, E), E < 40.
% a small, fading grudge in a good mood lets go
wants(P, forgive)      :- rel(P, "player", grudge, G), G > 0, G < 40, mood(P, M), M >= 3.

% ---- SOFT at level 2 (core.lp: the arc and hostility 3, the dice 1-2): an unwanted act costs 3, small talk over a wanted act 1 ----------
:~ social_action(P, A), A != small_talk, not wants(P, A). [3@2, P, A]
:~ social_action(P, small_talk), wants(P, A), A != small_talk. [1@2, P]
% concealing affection beats forgiving: when both are wanted, the guarded heart does not announce a pardon
:~ social_action(P, forgive), wants(P, conceal_affection). [2@2, P]
% and reconciling below trust 50 costs more than keeping distance
:~ social_action(P, reconcile), rel(P, "player", trust, T), T < 50. [2@2, P]
:~ social_action(P, reconcile), wants(P, keep_distance). [2@2, P]
:~ social_action(P, help), mood(P, M), M <= -5. [1@2, P]
% high social importance: no open insult
:~ social_action(P, insult), si(P, "player", S), S >= 8. [2@2, P]

% ---- demeanor (derived, shown to the narrator as tone) ---------------------------------------------------------------------------------
demeanor(P, hostile) :- npc(P), present(P), hostile(P).
demeanor(P, cold)    :- npc(P), present(P), not hostile(P), rel(P, "player", grudge, G), G >= 30.
demeanor(P, guarded) :- npc(P), present(P), not hostile(P), not demeanor(P, cold), rel(P, "player", trust, T), T < 40.
demeanor(P, warm)    :- npc(P), present(P), not hostile(P), rel(P, "player", affection, A), A >= 50, rel(P, "player", grudge, G), G < 30,
                        rel(P, "player", trust, T), T >= 40.
demeanor(P, neutral) :- npc(P), present(P), not demeanor(P, hostile), not demeanor(P, cold), not demeanor(P, guarded), not demeanor(P, warm).
may_silent(P) :- npc(P), present(P), trait(P, extra, E), E < 35, demeanor(P, cold).
may_silent(P) :- npc(P), present(P), emotion(P, fear, I), I >= 6.

#show social_action/2.
#show demeanor/2.
#show wants/2.
#show may_silent/1.
