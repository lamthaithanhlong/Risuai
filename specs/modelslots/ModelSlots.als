// Model slots, the stored shape. Alloy 6 (temporal).
//  * Operations keep the state valid (the Dafny file proves it for the code; this finds a counterexample for any weaker design).
//  * The slot list, the active id and the two model fields must be written as ONE block. Risu saves the root of the database as one
//    block, and the last writer wins; this shows that mixing fields of two writers can break the state, so none may be split.
open util/boolean

sig Model {}                       // an aiModel id
sig Req {}                         // a request model name
one sig Custom extends Model {}    // the Custom API ("reverse_proxy"): the only model that uses a request model

sig Slot { model: one Model, req: one Req }

sig State {
  slots: set Slot,
  active: lone Slot,
  curModel: one Model,
  curReq: one Req
}

fun cap: Int { 4 }

pred shows[s: Slot, m: Model, r: Req] { s.model = m and (s.model = Custom implies s.req = r) }

pred valid[st: State] {
  #st.slots <= cap
  st.active in st.slots
  some st.active implies shows[st.active, st.curModel, st.curReq]
}

// ---- operations on a state, producing the next one ------------------------------------------------------------------------
pred select[a, b: State, s: Slot] {
  s in a.slots
  b.slots = a.slots
  b.active = s
  b.curModel = s.model
  b.curReq = (s.model = Custom implies s.req else a.curReq)
}
pred remove[a, b: State, s: Slot] {
  s in a.slots
  b.slots = a.slots - s
  b.active = (a.active = s implies none else a.active)
  b.curModel = a.curModel and b.curReq = a.curReq
}
pred legacyEdit[a, b: State, m: Model, r: Req] {
  b.slots = a.slots
  b.curModel = m and b.curReq = r
  (some a.active and shows[a.active, m, r]) implies b.active = a.active else no b.active
}
pred add[a, b: State, s: Slot] {
  s not in a.slots and #a.slots < cap
  b.slots = a.slots + s
  b.active = a.active and b.curModel = a.curModel and b.curReq = a.curReq
}

assert SelectKeepsValid { all a, b: State, s: Slot | valid[a] and select[a, b, s] implies valid[b] }
assert RemoveKeepsValid { all a, b: State, s: Slot | valid[a] and remove[a, b, s] implies valid[b] }
assert LegacyEditKeepsValid { all a, b: State, m: Model, r: Req | valid[a] and legacyEdit[a, b, m, r] implies valid[b] }
assert AddKeepsValid { all a, b: State, s: Slot | valid[a] and add[a, b, s] implies valid[b] }
check SelectKeepsValid for 6 but 2 State
check RemoveKeepsValid for 6 but 2 State
check LegacyEditKeepsValid for 6 but 2 State
check AddKeepsValid for 6 but 2 State

// ---- weaker designs: each one has a counterexample ------------------------------------------------------------------------
// (a) removing the active slot but keeping it active (a dangling pointer)
pred removeKeepsActive[a, b: State, s: Slot] {
  s in a.slots and b.slots = a.slots - s and b.active = a.active and b.curModel = a.curModel and b.curReq = a.curReq
}
assert DanglingActive { all a, b: State, s: Slot | valid[a] and removeKeepsActive[a, b, s] implies valid[b] }
check DanglingActive for 6 but 2 State      // expected: a counterexample

// (b) a direct edit of the model fields that leaves the slot active
pred legacyEditKeepsActive[a, b: State, m: Model, r: Req] {
  b.slots = a.slots and b.curModel = m and b.curReq = r and b.active = a.active
}
assert StaleActive { all a, b: State, m: Model, r: Req | valid[a] and legacyEditKeepsActive[a, b, m, r] implies valid[b] }
check StaleActive for 6 but 2 State         // expected: a counterexample

// (c) two writers, each valid; the stored root takes the slot list and active id from one and the model fields from the other
pred mixedFields[w1, w2, stored: State] {
  stored.slots = w1.slots and stored.active = w1.active and stored.curModel = w2.curModel and stored.curReq = w2.curReq
}
assert FieldsInOneBlock { all w1, w2, stored: State | valid[w1] and valid[w2] and mixedFields[w1, w2, stored] implies valid[stored] }
check FieldsInOneBlock for 6 but 3 State    // expected: a counterexample, which is why all four fields live in the root block
// the whole root of one writer is always valid
assert WholeRoot { all w1, stored: State | valid[w1] and stored.slots = w1.slots and stored.active = w1.active and stored.curModel = w1.curModel and stored.curReq = w1.curReq implies valid[stored] }
check WholeRoot for 6 but 2 State
