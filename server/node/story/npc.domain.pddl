; An NPC's own moves toward the player, for the Game Master's turn (server/node/gmSolver.cjs): when the turn's chosen event is
; an absent enemy's, the enemy comes closer off-stage, one step a turn, along the world's roads (the world's own place graph from
; story/<world>.world.pddl, or the chat's places). A plan exists only for the living; the player stays where they are.
(define (domain npc-moves)
  (:requirements :strips :typing :negative-preconditions)
  (:types place person)
  (:predicates (connected ?a ?b - place) (person-at ?x - person ?p - place) (player-at ?p - place) (dead ?x - person) (near ?x - person))
  (:action move :parameters (?x - person ?from ?to - place)
    :precondition (and (person-at ?x ?from) (connected ?from ?to) (not (dead ?x)))
    :effect (and (person-at ?x ?to) (not (person-at ?x ?from))))
  (:action close-in :parameters (?x - person ?p - place)
    :precondition (and (person-at ?x ?p) (player-at ?p) (not (dead ?x)))
    :effect (near ?x)))
