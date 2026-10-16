-- One rule for the lore of any card (src/ts/process/loreIndex.ts planLore, fitPicks). Checked (Alloy 6, 2026-10-15), after the
-- live Adv1 measurement: key words loaded no canon entry of a Vietnamese story; full lore is 147k tokens.
open util/integer
sig Entry { tokens: one Int, picked: one Bool, loaded: one Bool }
abstract sig Bool {} one sig T, F extends Bool {}
one sig Card { budget: one Int, alwaysOn: one Int, mode: one Mode, helperCalled: one Bool }
abstract sig Mode {} one sig All, Hints extends Mode {}
fact sizes { all e: Entry | e.tokens > 0 and e.tokens < 8   Card.budget >= 0  Card.alwaysOn >= 0  Card.alwaysOn < 8 }
fun room: Int { let r = minus[Card.budget, Card.alwaysOn] | (r < 0 implies 0 else r) }
fun keyword: Int { sum e: Entry | e.tokens }
fun loadedSum: Int { sum e: { e: Entry | e.loaded = T } | e.tokens }
-- planLore
fact plan { (keyword <= room) <=> Card.mode = All }
fact helper { Card.helperCalled = T <=> Card.mode = Hints }
-- all: everything loaded; hints: only picked entries, and fitPicks keeps the sum within the room
fact load { Card.mode = All implies (all e: Entry | e.loaded = T)
            Card.mode = Hints implies ((all e: Entry | e.loaded = T implies e.picked = T) and loadedSum <= room) }

assert NeverOverBudget { Card.budget >= Card.alwaysOn implies plus[Card.alwaysOn, loadedSum] <= Card.budget }
assert FitsMeansAllNoHelper { keyword <= room implies (Card.helperCalled = F and (all e: Entry | e.loaded = T)) }
assert OnlyPickedWhenTooBig { Card.mode = Hints implies (all e: Entry | e.loaded = T implies e.picked = T) }
check NeverOverBudget for 5 but 5 Int
check FitsMeansAllNoHelper for 5 but 5 Int
check OnlyPickedWhenTooBig for 5 but 5 Int
run SomeHintsTurnLoadsLore { Card.mode = Hints and some e: Entry | e.loaded = T } for 4 but 5 Int
