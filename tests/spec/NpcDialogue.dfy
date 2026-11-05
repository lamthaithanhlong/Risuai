// risu-npc-dialogue — the core of the NPC-dialogue checker (design: nguoi-dua-thu-khung-bo/.pm-risu-5h/npc-dialogue-algorithm.md)
//
// Models: one NPC's state card (needs, has, knows, trust, promises, received), the per-turn transition the
// bookkeeper ledger folds into, and Accept(): the verdict on ONE reply of that NPC, given the structured facts
// a deterministic extractor pulled from her quoted lines (requests, offers, refusals, items handed/placed,
// quest-hook flag, exposition flag, sentence count).
//
// NOT MODELLED: the extraction itself (regex over Vietnamese text -> Facts). That is the JS mirror's job
// (src/ts/process/npcCheck.mjs) and its unit tests; Dafny proves the verdict over the facts, not the parsing.
// Grammar/naturalness (class 1) is not a fact Dafny can see: only its countable part, the sentence cap, is here.
//
// The JS/Lua implementation must mirror Accept and Step 1:1 (same clauses, same order); the test table in
// npcCheck.test.ts is derived from the Witness* lemmas below (each bad example = a witness that Accept rejects).

type Item = string

datatype Npc = Npc(
  isAdmin: bool,            // the global Admin is the only speaker allowed to hand out a task
  needs: set<Item>,         // what she lacks and wants now
  has: map<Item, nat>,      // what she holds, with a count; a key is present only while count >= 1
  knows: set<string>,       // facts she witnessed or heard (used by the hook exemption in JS; opaque here)
  trust: int,               // 0..100 toward the player
  promises: set<string>,    // open promises she made
  received: set<Item>       // items the player gave her this scene
)

// Facts the extractor reports for one reply of one NPC.
datatype Facts = Facts(
  requests: set<Item>,      // items she asks for
  offers: set<Item>,        // items she offers to give
  refusals: set<Item>,      // items she declines ("anh giữ lại", "đừng đưa")
  handed: set<Item>,        // items she hands over or puts down
  questHook: bool,          // errand / other place / "nếu anh X thì tôi Y"
  exposition: bool,         // states her own motive ("tôi chỉ đang cố…")
  playerAskedWhy: bool,     // the player's message asked why / what for
  reasonFlag: bool,         // a reason for refusing is in the scene (state flag or explicit cause in the line)
  sentences: nat,           // sentences in her speech this reply
  unaddressed: bool         // a direct question or request to the player with no address term (anh/chị/cậu/em…/a name)
)

// Owner, 2026-11-05 (popup b): refusing what she needs is allowed ONLY when she distrusts the player (trust below LowTrust)
// AND the line says why ("Tôi chưa dám nhận đồ của người lạ"). Owner (popup a): "Anh còn nhiều thuốc không?" style questions
// need the address term of the relationship, so an unaddressed direct question is rejected (clause 6).
const LowTrust: int := 40

const MaxSentences: nat := 2

// ---- invariant of a state card ------------------------------------------------------------------------------
ghost predicate Inv(s: Npc) {
  (s.needs * s.received == {})                       // a need that the player met is no longer a need
  && (forall k :: k in s.has ==> s.has[k] >= 1)      // never zero or negative stock
  && 0 <= s.trust <= 100
}

// ---- the checker --------------------------------------------------------------------------------------------
predicate Accept(s: Npc, f: Facts) {
  (f.refusals * s.needs == {} || (f.reasonFlag && s.trust < LowTrust))  // (1) no refusal of a need, unless distrust + stated reason
  && f.handed <= s.has.Keys                          // (2) nothing handed/placed that she does not hold
  && f.offers <= s.has.Keys                          //     nor offered
  && (f.questHook ==> s.isAdmin)                     // (3) only Admin gives tasks
  && (f.exposition ==> f.playerAskedWhy)             // (4) no unprompted motive exposition
  && 1 <= f.sentences <= MaxSentences                // (5) 1..2 sentences
  && f.requests * s.has.Keys == {}                   //     never asks for what she already holds
  && !f.unaddressed                                  // (6) a direct question/request carries an address term
}

// ---- the transition (one turn): the player gives `given`, she hands over f.handed, new requests become needs -----
function Take(h: map<Item, nat>, out: set<Item>): map<Item, nat>
{
  map k | k in h && (k !in out || h[k] > 1) :: if k in out then h[k] - 1 else h[k]
}

function Put(h: map<Item, nat>, inn: set<Item>): map<Item, nat>
{
  map k | k in h.Keys + inn :: (if k in h then h[k] else 0) + (if k in inn then 1 else 0)
}

function Step(s: Npc, f: Facts, given: set<Item>, dTrust: int): Npc
{
  var has' := Put(Take(s.has, f.handed), given);
  var received' := s.received + given;
  var needs' := (s.needs + f.requests) - received' - has'.Keys;
  s.(has := has', received := received', needs := needs',
     trust := if s.trust + dTrust < 0 then 0 else if s.trust + dTrust > 100 then 100 else s.trust + dTrust)
}

// ---- contracts ------------------------------------------------------------------------------------------------
lemma AcceptNoNeedRefusal(s: Npc, f: Facts)
  requires Accept(s, f) && !(f.reasonFlag && s.trust < LowTrust)
  ensures forall i :: i in f.refusals ==> i !in s.needs
{
  forall i | i in f.refusals ensures i !in s.needs {
    if i in s.needs { assert i in f.refusals * s.needs; }
  }
}

lemma AcceptNoPhantomItem(s: Npc, f: Facts)
  requires Accept(s, f)
  ensures forall i :: i in f.handed ==> i in s.has && s.has[i] >= 0
{}

lemma AcceptHookOnlyAdmin(s: Npc, f: Facts)
  requires f.questHook && !s.isAdmin
  ensures !Accept(s, f)
{}

lemma AcceptNoUnpromptedExposition(s: Npc, f: Facts)
  requires f.exposition && !f.playerAskedWhy
  ensures !Accept(s, f)
{}

// (1') with trust at or above LowTrust, a reason alone does not license refusing a need
lemma AcceptTrustedNeverRefusesNeed(s: Npc, f: Facts)
  requires Accept(s, f) && s.trust >= LowTrust
  ensures f.refusals * s.needs == {}
{}

lemma AcceptAddressed(s: Npc, f: Facts)
  requires Accept(s, f)
  ensures !f.unaddressed
{}

lemma AcceptSentenceCap(s: Npc, f: Facts)
  requires Accept(s, f)
  ensures f.sentences <= 2
{}

lemma StepPreservesInv(s: Npc, f: Facts, given: set<Item>, dTrust: int)
  requires Inv(s) && Accept(s, f)
  ensures Inv(Step(s, f, given, dTrust))
{}

lemma StepGivenIsHeld(s: Npc, f: Facts, given: set<Item>, dTrust: int)
  requires Inv(s) && Accept(s, f)
  ensures given <= Step(s, f, given, dTrust).has.Keys
  ensures given * Step(s, f, given, dTrust).needs == {}
{}

// ---- witnesses: the owner's live examples (2026-11-05, Zombie, 704 balcony) ------------------------------------
const Pain: Item := "thuoc_giam_dau"
const Fever: Item := "thuoc_ha_sot"
const Wash: Item := "do_rua_vet_thuong"

// turn 11: she has pulled the painkillers over; she needs fever medicine and something to wash the wound
function Balcony(): Npc {
  Npc(false, {Fever, Wash}, map[Pain := 1], {}, 30, {}, {Pain})
}

lemma BalconyInv() ensures Inv(Balcony()) {}

// class 3: "Vậy anh giữ lại mà dùng. Tôi chỉ xin thuốc giảm đau." + puts "gói thuốc" down + "đừng đưa [hạ sốt]"
lemma WitnessContradiction()
  ensures !Accept(Balcony(), Facts({Pain}, {}, {Fever}, {}, false, false, false, false, 3, false))
{}

// class 3b: she places a pack she does not hold (the fever medicine is the player's)
lemma WitnessPhantomPack()
  ensures !Accept(Balcony(), Facts({}, {}, {}, {Fever}, false, false, false, false, 1, false))
{}

// class 2: "Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được thuốc ở đó, tôi sẽ tin lời anh hơn."
lemma WitnessQuestHook()
  ensures !Accept(Balcony(), Facts({}, {}, {}, {}, true, false, false, false, 1, false))
{}

// class 4: "Tôi không biết … hơn anh đâu. Tôi chỉ đang cố giữ cánh tay này khỏi nhiễm trùng."
lemma WitnessExposition()
  ensures !Accept(Balcony(), Facts({}, {}, {}, {}, false, true, false, false, 2, false))
{}

// approved: "Cánh tay tôi bị cứa. Tôi cần thuốc hạ sốt, hoặc thứ gì đó để rửa vết thương." (turn 9, before the painkillers)
lemma WitnessApproved()
  ensures Accept(Npc(false, {}, map[], {}, 30, {}, {}), Facts({Fever, Wash}, {}, {}, {}, false, false, false, false, 2, false))
{}

// owner's consistent line for turn 13: "Anh còn thuốc giảm đau không? Tay tôi đau lắm." asks for MORE of what she holds:
// Accept rejects a request for a held item, so the JS mirror marks "còn … không" (more of) as a distinct fact (moreOf),
// not a request. Documented here so the mirror does not silently loosen the clause.
lemma WitnessAskMoreIsNotARequest()
  ensures Accept(Balcony(), Facts({}, {}, {}, {}, false, false, false, false, 2, false))
{}

// owner popup (b): she distrusts the player (trust 30 < LowTrust) and says why: refusing the fever medicine is allowed
// ("Tôi chưa dám nhận đồ của người lạ, anh cứ giữ thuốc hạ sốt đi.")
lemma WitnessDistrustWithReasonMayRefuse()
  ensures Accept(Balcony(), Facts({}, {}, {Fever}, {}, false, false, false, true, 1, false))
{}

// same words once she trusts him (trust 60): the reason no longer licenses refusing what she needs
lemma WitnessTrustedRefusalRejected()
  ensures !Accept(Balcony().(trust := 60), Facts({}, {}, {Fever}, {}, false, false, false, true, 1, false))
{ assert Fever in {Fever} * Balcony().(trust := 60).needs; }

// distrust but no stated reason: rejected
lemma WitnessDistrustNoReasonRejected()
  ensures !Accept(Balcony(), Facts({}, {}, {Fever}, {}, false, false, false, false, 1, false))
{ assert Fever in {Fever} * Balcony().needs; }

// owner popup (a): "Còn nhiều thuốc không?" with no address term is rejected; "Anh còn thuốc không, cho em xin ít?" is accepted
lemma WitnessUnaddressedQuestionRejected()
  ensures !Accept(Balcony(), Facts({}, {}, {}, {}, false, false, false, false, 1, true))
{}

lemma WitnessAddressedAskMoreAccepted()
  ensures Accept(Balcony(), Facts({}, {}, {}, {}, false, false, false, false, 1, false))
{}

// "Tôi chỉ xin thuốc giảm đau." alone (1 sentence): asking for what she already holds is rejected on its own,
// not only together with the sentence cap (WitnessContradiction has both)
lemma WitnessAskForHeldRejected()
  ensures !Accept(Balcony(), Facts({Pain}, {}, {}, {}, false, false, false, false, 1, false))
{ assert Pain in {Pain} * Balcony().has.Keys; }

// the sentence cap alone: three plain sentences are rejected
lemma WitnessThreeSentencesRejected()
  ensures !Accept(Balcony(), Facts({}, {}, {}, {}, false, false, false, false, 3, false))
{}
