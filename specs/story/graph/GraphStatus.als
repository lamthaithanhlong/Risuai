-- The librarian's knowledge graph: what a fact's status and its knowers may say together (story/schema/lore-graph.schema.json,
-- story/graphs/build/merge.cjs, server/node/storyGraph.cjs, story/gm/graph.lp). Checked with Alloy 6:
--   SchemaOnly*  : the JSON Schema alone allows a rumor someone "knows as fact" and an unknown that someone knows (expected: counterexample)
--   Merged*      : after merge.cjs's rules (a rumor's knowers know it as rumor; an unknown known to someone is a secret: a fact with
--                  knowers), neither happens (expected: no counterexample)
--   Derived      : graph.lp's weakest-status rule never makes a derived relation stronger than what it rests on, and nothing is
--                  derived from an outdated or unknown fact (expected: no counterexample)
--   Ended        : storyGraph.cjs factsAbout: a fact ended at turn T is outdated at every turn from T and keeps its status before T

abstract sig Status {}
one sig Fact_, Rumor, Unknown, Outdated extends Status {}
abstract sig As {}
one sig AsFact, AsRumor extends As {}
sig Entity {}
sig Fact { st: one Status, knows: Entity -> lone As, endsAt: lone Int }

fun strength[s: Status]: Int { s = Fact_ => 2 else s = Rumor => 1 else 0 }

-- what the JSON Schema says: any status, any knowers
pred schemaOnly {}
-- what merge.cjs adds
pred merged {
    all f: Fact | f.st = Rumor implies Entity.(f.knows) in AsRumor
    all f: Fact | f.st = Unknown implies no f.knows
}
assert SchemaOnlyRumorKnownAsFact { schemaOnly implies no f: Fact | f.st = Rumor and AsFact in Entity.(f.knows) }
assert SchemaOnlyUnknownKnown { schemaOnly implies no f: Fact | f.st = Unknown and some f.knows }
assert MergedRumorKnownAsFact { merged implies no f: Fact | f.st = Rumor and AsFact in Entity.(f.knows) }
assert MergedUnknownKnown { merged implies no f: Fact | f.st = Unknown and some f.knows }
check SchemaOnlyRumorKnownAsFact for 4
check SchemaOnlyUnknownKnown for 4
check MergedRumorKnownAsFact for 4
check MergedUnknownKnown for 4

-- graph.lp: weaker(A, B, W) over fact|rumor; a derivation from two premises
sig Derivation { p1, p2: one Fact, result: one Status }
fact weakest {
    all d: Derivation | d.p1.st in (Fact_ + Rumor) and d.p2.st in (Fact_ + Rumor)
    all d: Derivation | d.result = (strength[d.p1.st] <= strength[d.p2.st] implies d.p1.st else d.p2.st)
}
assert Derived {
    all d: Derivation | strength[d.result] <= strength[d.p1.st] and strength[d.result] <= strength[d.p2.st]
    all d: Derivation | d.result not in (Outdated + Unknown)
}
check Derived for 5

-- storyGraph.cjs factsAbout: the status a chat sees at turn n
fun seen[f: Fact, n: Int]: Status { (some f.endsAt and f.endsAt <= n) implies Outdated else f.st }
assert Ended {
    all f: Fact, n: Int | some f.endsAt and n >= f.endsAt implies seen[f, n] = Outdated
    all f: Fact, n: Int | (no f.endsAt or n < f.endsAt) implies seen[f, n] = f.st
}
check Ended for 4 but 4 Int
