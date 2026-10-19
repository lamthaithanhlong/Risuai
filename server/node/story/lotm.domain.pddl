; Lord of the Mysteries as the Fate Simulator card plays it (Module 03 Pathway and Potion, Module 04 Progression; lore "Beyonder
; potions and digestion", canon card "Notable potions, formulas and ingredients"). The rules a plan must respect, each one a
; precondition:
;  - a Sequence is reached only by drinking its potion, and only the next one: s10 (an ordinary person) -> s9 -> s8 ... -> s0
;  - a potion needs its formula and its ingredients, brewed in a safe place; the formula comes from an organization the character
;    belongs to or from a dealer they have met; common ingredients are bought at a Beyonder gathering, those of Sequence 6 and
;    stronger must be hunted where it is dangerous, which exhausts until a rest in a shelter (an exhausted Beyonder can still
;    walk back to safety, but cannot venture, hunt, perform a ritual or drink)
;  - the next potion is drunk only once the current one is digested, and digestion is done only by acting (no skipping by
;    training, money or a won fight); Sequence 4 and stronger also need their advancement ritual
;  - you meet only the living, and join an organization only through its leader, in its seat, after meeting them
(define (domain lotm)
  (:requirements :strips :typing :negative-preconditions)
  (:types place person faction seq)
  (:predicates
    (at ?p - place) (connected ?a ?b - place) (safe ?p - place) (shelter ?p - place) (market ?p - place) (hunting-ground ?p - place)
    (exhausted)
    (seq ?s - seq) (next ?a ?b - seq) (beyonder-seq ?s - seq) (common ?s - seq) (rare ?s - seq) (ritual ?s - seq) (no-ritual ?s - seq)
    (digested) (has-formula ?s - seq) (has-ingredients ?s - seq) (potion ?s - seq) (ritual-done ?s - seq)
    (person-at ?x - person ?p - place) (met ?x - person) (dead ?x - person) (dealer ?x - person)
    (faction-seat ?f - faction ?p - place) (leads ?x - person ?f - faction) (member ?f - faction) (formula-source ?f - faction))

  (:action travel :parameters (?from ?to - place)
    :precondition (and (at ?from) (connected ?from ?to) (safe ?to))
    :effect (and (at ?to) (not (at ?from))))
  (:action venture :parameters (?from ?to - place)
    :precondition (and (at ?from) (connected ?from ?to) (not (safe ?to)) (not (exhausted)))
    :effect (and (at ?to) (not (at ?from))))
  (:action rest :parameters (?p - place)
    :precondition (and (at ?p) (shelter ?p) (exhausted))
    :effect (not (exhausted)))

  (:action meet :parameters (?x - person ?p - place)
    :precondition (and (at ?p) (person-at ?x ?p) (not (dead ?x)))
    :effect (met ?x))
  (:action join-faction :parameters (?f - faction ?x - person ?p - place)
    :precondition (and (at ?p) (faction-seat ?f ?p) (leads ?x ?f) (met ?x) (not (dead ?x)))
    :effect (member ?f))

  (:action obtain-formula :parameters (?f - faction ?cur ?s - seq)
    :precondition (and (member ?f) (formula-source ?f) (seq ?cur) (next ?cur ?s))
    :effect (has-formula ?s))
  (:action buy-formula :parameters (?x - person ?p - place ?cur ?s - seq)
    :precondition (and (at ?p) (person-at ?x ?p) (dealer ?x) (met ?x) (not (dead ?x)) (seq ?cur) (next ?cur ?s))
    :effect (has-formula ?s))
  (:action buy-ingredients :parameters (?s - seq ?p - place)
    :precondition (and (at ?p) (market ?p) (has-formula ?s) (common ?s))
    :effect (has-ingredients ?s))
  (:action hunt-ingredients :parameters (?s - seq ?p - place)
    :precondition (and (at ?p) (hunting-ground ?p) (has-formula ?s) (rare ?s) (not (exhausted)))
    :effect (and (has-ingredients ?s) (exhausted)))
  (:action brew :parameters (?s - seq ?p - place)
    :precondition (and (at ?p) (shelter ?p) (has-formula ?s) (has-ingredients ?s))
    :effect (and (potion ?s) (not (has-ingredients ?s))))
  (:action perform-ritual :parameters (?s - seq ?p - place)
    :precondition (and (at ?p) (safe ?p) (ritual ?s) (potion ?s) (not (exhausted)))
    :effect (ritual-done ?s))

  (:action drink-potion :parameters (?cur ?s - seq)
    :precondition (and (seq ?cur) (next ?cur ?s) (potion ?s) (digested) (no-ritual ?s) (not (exhausted)))
    :effect (and (seq ?s) (not (seq ?cur)) (not (potion ?s)) (not (digested)) (not (has-formula ?s)) (not (ritual-done ?s))))
  (:action drink-potion-with-ritual :parameters (?cur ?s - seq)
    :precondition (and (seq ?cur) (next ?cur ?s) (potion ?s) (digested) (ritual ?s) (ritual-done ?s) (not (exhausted)))
    :effect (and (seq ?s) (not (seq ?cur)) (not (potion ?s)) (not (digested)) (not (has-formula ?s)) (not (ritual-done ?s))))
  (:action act :parameters (?s - seq)
    :precondition (and (seq ?s) (beyonder-seq ?s) (not (digested)))
    :effect (digested)))
