-- The NPC psychology's data (story/npcs seed files, npc-profile.schema.json, npcs/appraisal.json, story/gm/npc.lp; plan §5-§7, §14).
-- Checked with Alloy 6, in the style of ../graph/GraphStatus.als:
--   SchemaOnly*  : what the schema (types, 0..100) alone allows (expected: counterexample)
--   the rest     : after the rule the code adds (expected: no counterexample)
-- SCALE: the real numbers are 0..100 (Big Five traits, trust/affection/debt/grudge). An Alloy Int is a few bits wide, so one unit
-- here is 10 points: 0..10 stands for 0..100, trust >= 30 is 3, trust >= 60 is 6, an appraisal step of +-30 is +-3. The checks are
-- about the shape (range, who may confide, who may own a profile), not about the size of the steps, so the scaling loses nothing.
-- Ints are 5 bits (-16..15): 10 + 3 = 13 and 0 - 3 = -3 fit, so a counterexample is the rule's gap, never a wrap-around.

sig Person {}
one sig Player extends Person {}
abstract sig Trait {}
one sig Open, Consc, Extra, Agree, Neuro extends Trait {}
abstract sig Dim {}
one sig Trust, Affection, Debt, Grudge extends Dim {}

-- a profile's owner is a Person; the schema alone does not say it is not the player
sig Profile { owner: one Person, traits: Trait -> one Int }
sig Secret { of: one Profile }                 -- has_secret(P): a profile with a wants_to_hide
-- a directional relation: p's view of q (q may be the player)
sig Rel { p, q: one Person, dims: Dim -> one Int }

-- facts the schema, merge.cjs and the tables guarantee in every state
fact NoSelfPair { all r: Rel | r.p != r.q }
fact PairUnique { all disj r1, r2: Rel | not (r1.p = r2.p and r1.q = r2.q) }
fact SeedRanges { all r: Rel, d: Dim | r.dims[d] >= 0 and r.dims[d] <= 10
                  all pr: Profile, t: Trait | pr.traits[t] >= 0 and pr.traits[t] <= 10 }

-- merge.cjs: the player's persona is never an npc (a profile is never the player's)
pred noPlayerProfile { all pr: Profile | pr.owner not in Player }
assert SchemaOnlyPlayerProfile { no pr: Profile | pr.owner in Player }
assert PlayerNoProfile { noPlayerProfile implies no pr: Profile | pr.owner in Player }
check SchemaOnlyPlayerProfile for 4 but 5 int
check PlayerNoProfile for 4 but 5 int

-- one appraisal step on one dimension of one relation (appraisal.json delta, Math.round, clamp 0..100 after each event)
sig Step { r: one Rel, d: one Dim, delta: one Int }
fact StepDelta { all s: Step | s.delta >= -3 and s.delta <= 3 }
fun clamp[x: Int]: Int { x < 0 => 0 else x > 10 => 10 else x }
fun raw[s: Step]: Int { plus[s.r.dims[s.d], s.delta] }
fun clamped[s: Step]: Int { clamp[raw[s]] }
-- the number after the step is in range whatever the number before it was: so a fold of any length stays in range
assert NoClampInRange { all s: Step | raw[s] >= 0 and raw[s] <= 10 }
assert InRange { all s: Step | clamped[s] >= 0 and clamped[s] <= 10 }
-- and a step the clamp does not touch changes the number by exactly the delta
assert ClampExactInside { all s: Step | raw[s] >= 0 and raw[s] <= 10 implies clamped[s] = raw[s] }
check NoClampInRange for 4 but 5 int
check InRange for 4 but 5 int
check ClampExactInside for 4 but 5 int

-- npc.lp's two hard rules for "confide": below trust 30 nothing is volunteered; a hidden secret needs trust 60 even then
sig Confide { r: one Rel }
pred hardRules {
    all c: Confide | c.r.q in Player
    all c: Confide | c.r.dims[Trust] >= 3
    all c: Confide | (some s: Secret | s.of.owner = c.r.p) implies c.r.dims[Trust] >= 6
}
assert SchemaOnlyConfide { all c: Confide | c.r.dims[Trust] >= 3 and ((some s: Secret | s.of.owner = c.r.p) implies c.r.dims[Trust] >= 6) }
assert NoSecretVolunteered {
    hardRules implies all c: Confide | c.r.dims[Trust] >= 3 and ((some s: Secret | s.of.owner = c.r.p) implies c.r.dims[Trust] >= 6)
}
-- the rules do not shut confiding out altogether: it happens with trust 6 for a person with a secret
run ConfideWithSecret { hardRules and some c: Confide | some s: Secret | s.of.owner = c.r.p and c.r.dims[Trust] = 6 } for 4 but 5 int
check SchemaOnlyConfide for 6 but 5 int
check NoSecretVolunteered for 6 but 5 int
