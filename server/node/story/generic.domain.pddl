; Any story whose card is none of the known worlds. The world is built from the chat itself (storyLogic.cjs): every place the chat
; names (the panel's place, where NPCs were last seen, Region lore keys the timeline uses) is a place, all of them reachable from
; one another, and every NPC the ledger knows is a person, at the place they were last seen. A plan can only travel and meet:
; you meet only the living, and only where they are.
(define (domain generic-story)
  (:requirements :strips :typing :negative-preconditions)
  (:types place person)
  (:predicates (at ?p - place) (connected ?a ?b - place) (person-at ?x - person ?p - place) (met ?x - person) (dead ?x - person))
  (:action travel :parameters (?from ?to - place)
    :precondition (and (at ?from) (connected ?from ?to))
    :effect (and (at ?to) (not (at ?from))))
  (:action meet :parameters (?x - person ?p - place)
    :precondition (and (at ?p) (person-at ?x ?p) (not (dead ?x)))
    :effect (met ?x)))
