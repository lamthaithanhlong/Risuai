; The places, people and factions a plan can use (the Forgotten Shore arc, regions/forgotten_shore.md), and the static facts about
; them. storyLogic.cjs reads this file, adds the player's state from story.sqlite (where they are, their Rank, who they met, who is
; dead) and the goal, and hands the result to the planner. Lines "; alias <object>: name, name" map the story's words to objects.
; alias outskirts: outskirts, ngoại ô, nqsc, khu ngoại ô
; alias academy: awakened academy, học viện thức tỉnh, học viện
; alias labyrinth: crimson labyrinth, labyrinth, mê cung
; alias ashen-barrow: ashen barrow, gò tro
; alias dark-city: dark city, thành phố bóng tối
; alias bright-castle: bright castle, lâu đài sáng, lâu đài ánh sáng
; alias crimson-spire: crimson spire, tháp đỏ thẫm, ngọn tháp đỏ
; alias nephis: nephis, changing star, ngôi sao biến đổi
; alias cassie: cassie, cassia
; alias gunlaug: gunlaug, bright lord
; alias kai: kai, nightingale
; alias caster: caster
; alias harper: harper
; alias effie: effie
; alias castle: lâu đài, bright castle, castle, người của gunlaug
; alias changing-star-group: nhóm của nephis, changing star's group, nephis's group
(define (problem shadow-slave-world) (:domain shadow-slave)
  (:objects
    outskirts academy labyrinth ashen-barrow dark-city bright-castle crimson-spire - place
    nephis cassie gunlaug kai caster harper effie - person
    soul-shard - item
    castle changing-star-group - faction)
  (:init
    (waking outskirts) (waking academy) (return-point academy)
    (safe outskirts) (shelter outskirts) (safe academy) (shelter academy)
    (connected outskirts academy) (connected academy outskirts)
    (dream labyrinth) (dream ashen-barrow) (dream dark-city) (dream bright-castle) (dream crimson-spire)
    (arrival labyrinth) (arrival ashen-barrow)
    (connected labyrinth ashen-barrow) (connected ashen-barrow labyrinth)
    (connected labyrinth dark-city) (connected dark-city labyrinth)
    (connected dark-city bright-castle) (connected bright-castle dark-city)
    (connected dark-city crimson-spire) (connected crimson-spire dark-city)
    (connected labyrinth crimson-spire) (connected crimson-spire labyrinth)
    (safe ashen-barrow) (shelter ashen-barrow) (safe bright-castle) (shelter bright-castle) (shelter dark-city)
    (gateway crimson-spire)
    (person-at nephis dark-city) (person-at cassie dark-city) (person-at effie dark-city)
    (person-at gunlaug bright-castle) (person-at kai bright-castle) (person-at caster bright-castle) (person-at harper bright-castle)
    (item-at soul-shard dark-city)
    (faction-seat castle bright-castle) (leads gunlaug castle)
    (faction-seat changing-star-group dark-city) (leads nephis changing-star-group))
  (:goal (and)))
