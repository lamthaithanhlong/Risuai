; The places, people and organizations of the early Lord of the Mysteries story (lore locations/tingen, backlund, pritz; canon card
; "Churches and key buildings of Tingen and Backlund"), and the static facts about them. storyLogic.cjs reads this file, adds the
; character's state from story.sqlite (where they are, their Sequence and digestion, who they met, who is dead, their
; organization) and the goal. Lines "; alias <object>: name, name" map the story's words to objects.
; alias tingen: tingen, phố bồ nông, pelican street, quận akhova, akhova, đại học khoy, khoy
; alias zoutelande: zoutelande, black thorn, blackthorn, bụi gai đen, công ty an ninh bụi gai đen, phố zoutelande
; alias backlund: backlund, khu hoa hồng trắng, rose white district, quận hoàng hậu, queen district
; alias pritz: pritz, cảng pritz, pritz harbor
; alias bayam: bayam, roth, đảo roth
; alias sunia-sea: sunia sea, biển sunia
; alias trier: trier, intis
; alias dunn: dunn smith, dunn
; alias old-neil: old neil, neil, lão neil
; alias leonard: leonard mitchell, leonard
; alias azik: azik eggers, azik
; alias audrey: audrey hall, audrey
; alias nighthawks: nighthawks, kẻ gác đêm, đội kẻ gác đêm
(define (problem lotm-world) (:domain lotm)
  (:objects
    tingen zoutelande backlund pritz bayam sunia-sea trier - place
    dunn old-neil leonard azik audrey - person
    nighthawks - faction
    s10 s9 s8 s7 s6 s5 s4 s3 s2 s1 s0 - seq)
  (:init
    (safe tingen) (shelter tingen) (market tingen) (safe zoutelande) (shelter zoutelande)
    (safe backlund) (shelter backlund) (market backlund) (safe pritz) (safe bayam) (shelter bayam) (safe trier) (shelter trier)
    (hunting-ground sunia-sea)
    (connected tingen zoutelande) (connected zoutelande tingen) (connected tingen backlund) (connected backlund tingen)
    (connected backlund pritz) (connected pritz backlund) (connected backlund trier) (connected trier backlund)
    (connected pritz bayam) (connected bayam pritz) (connected bayam sunia-sea) (connected sunia-sea bayam)
    (next s10 s9) (next s9 s8) (next s8 s7) (next s7 s6) (next s6 s5) (next s5 s4) (next s4 s3) (next s3 s2) (next s2 s1) (next s1 s0)
    (beyonder-seq s9) (beyonder-seq s8) (beyonder-seq s7) (beyonder-seq s6) (beyonder-seq s5) (beyonder-seq s4) (beyonder-seq s3)
    (beyonder-seq s2) (beyonder-seq s1) (beyonder-seq s0)
    (common s9) (common s8) (common s7) (rare s6) (rare s5) (rare s4) (rare s3) (rare s2) (rare s1) (rare s0)
    (no-ritual s9) (no-ritual s8) (no-ritual s7) (no-ritual s6) (no-ritual s5)
    (ritual s4) (ritual s3) (ritual s2) (ritual s1) (ritual s0)
    (person-at dunn zoutelande) (person-at old-neil zoutelande) (person-at leonard zoutelande) (person-at azik tingen)
    (person-at audrey backlund)
    (faction-seat nighthawks zoutelande) (leads dunn nighthawks) (formula-source nighthawks) (dealer old-neil))
  (:goal (and)))
