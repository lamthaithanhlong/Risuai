// Model slots: up to 4 named model choices, one of them active, picked from the chat menu or set in the settings.
// The app's request code keeps reading the two legacy fields (model, req); a slot is applied by writing them, so the request code does
// not change. Proved here: every operation keeps the state Valid (at most 4 slots, unique ids, the active id names a slot, and the
// legacy fields agree with the active slot), and Normalize turns ANY stored data, however damaged, into a Valid state.
//   model = the aiModel id ("reverse_proxy" is the Custom API); req = the request model name, used only by reverse_proxy.

datatype Slot = Slot(id: string, name: string, model: string, req: string)
datatype St = St(slots: seq<Slot>, active: string, model: string, req: string)

const MAX: int := 4

predicate IdsUnique(s: seq<Slot>) {
  forall i, j :: 0 <= i < j < |s| ==> s[i].id != s[j].id
}

function IndexOf(s: seq<Slot>, id: string): int
  ensures -1 <= IndexOf(s, id) < |s|
  ensures IndexOf(s, id) >= 0 ==> s[IndexOf(s, id)].id == id
  ensures IndexOf(s, id) == -1 ==> forall i :: 0 <= i < |s| ==> s[i].id != id
{
  if |s| == 0 then -1
  else if s[0].id == id then 0
  else (var r := IndexOf(s[1..], id); if r < 0 then -1 else r + 1)
}

// the legacy fields show this slot: the model always, the request model only for the Custom API
predicate Shows(sl: Slot, model: string, req: string) {
  sl.model == model && (sl.model != "reverse_proxy" || sl.req == req)
}

predicate Valid(st: St) {
  |st.slots| <= MAX && IdsUnique(st.slots) &&
  (st.active == "" || (IndexOf(st.slots, st.active) >= 0 && Shows(st.slots[IndexOf(st.slots, st.active)], st.model, st.req)))
}

// apply a slot to the legacy fields
function Apply(sl: Slot, st: St): St {
  St(st.slots, sl.id, sl.model, if sl.model == "reverse_proxy" then sl.req else st.req)
}

// ---- operations -------------------------------------------------------------------------------------------------------------

// add a slot (the "add" button); refused when full or when the id is taken. The active slot and the legacy fields do not change.
function Add(st: St, sl: Slot): St
  requires Valid(st)
  ensures Valid(Add(st, sl))
  ensures |st.slots| < MAX && sl.id != "" && IndexOf(st.slots, sl.id) < 0 ==> Add(st, sl).slots == st.slots + [sl]
  ensures !(|st.slots| < MAX && sl.id != "" && IndexOf(st.slots, sl.id) < 0) ==> Add(st, sl) == st
{
  if |st.slots| < MAX && sl.id != "" && IndexOf(st.slots, sl.id) < 0 then
    var r := St(st.slots + [sl], st.active, st.model, st.req);
    assert IdsUnique(r.slots) by {
      forall i, j | 0 <= i < j < |r.slots| ensures r.slots[i].id != r.slots[j].id {
        if j == |st.slots| { assert r.slots[j] == sl; assert IndexOf(st.slots, sl.id) < 0; assert r.slots[i] == st.slots[i]; }
      }
    }
    IndexOfAppendAny(st.slots, sl, st.active);
    r
  else st
}

lemma IndexOfAppend(s: seq<Slot>, sl: Slot, id: string)
  requires IndexOf(s, id) >= 0
  ensures IndexOf(s + [sl], id) == IndexOf(s, id)
{
  if s[0].id == id { } else { assert (s + [sl])[1..] == s[1..] + [sl]; IndexOfAppend(s[1..], sl, id); }
}

lemma IndexOfAppendAny(s: seq<Slot>, sl: Slot, id: string)
  ensures IndexOf(s, id) >= 0 ==> IndexOf(s + [sl], id) == IndexOf(s, id)
{
  if IndexOf(s, id) >= 0 { IndexOfAppend(s, sl, id); }
}

// "save the current model as a slot": the new slot shows the legacy fields, and becomes the active one
function AddFromCurrent(st: St, id: string, name: string): St
  requires Valid(st)
  ensures Valid(AddFromCurrent(st, id, name))
{
  var sl := Slot(id, name, st.model, st.req);
  if |st.slots| < MAX && id != "" && IndexOf(st.slots, id) < 0 then
    var r := St(st.slots + [sl], id, st.model, st.req);
    assert IdsUnique(r.slots) by {
      forall i, j | 0 <= i < j < |r.slots| ensures r.slots[i].id != r.slots[j].id {
        if j == |st.slots| { assert r.slots[j] == sl; assert r.slots[i] == st.slots[i]; }
      }
    }
    assert IndexOf(r.slots, id) == |st.slots| by { IndexOfLast(st.slots, sl); }
    r
  else st
}

lemma IndexOfLast(s: seq<Slot>, sl: Slot)
  requires IndexOf(s, sl.id) < 0
  ensures IndexOf(s + [sl], sl.id) == |s|
{
  if |s| > 0 { assert (s + [sl])[1..] == s[1..] + [sl]; assert IndexOf(s[1..], sl.id) < 0; IndexOfLast(s[1..], sl); }
}

function RemoveAt(s: seq<Slot>, k: int): seq<Slot>
  requires 0 <= k < |s|
{
  s[..k] + s[k+1..]
}

lemma RemoveAtUnique(s: seq<Slot>, k: int)
  requires 0 <= k < |s| && IdsUnique(s)
  ensures IdsUnique(RemoveAt(s, k))
  ensures |RemoveAt(s, k)| == |s| - 1
  ensures forall id :: IndexOf(s, id) >= 0 && IndexOf(s, id) != k ==> IndexOf(RemoveAt(s, k), id) >= 0 && RemoveAt(s, k)[IndexOf(RemoveAt(s, k), id)] == s[IndexOf(s, id)]
{
  var r := RemoveAt(s, k);
  forall i, j | 0 <= i < j < |r| ensures r[i].id != r[j].id {
    var oi := if i < k then i else i + 1;
    var oj := if j < k then j else j + 1;
    assert r[i] == s[oi] && r[j] == s[oj] && oi < oj;
  }
  forall id | IndexOf(s, id) >= 0 && IndexOf(s, id) != k ensures IndexOf(r, id) >= 0 && r[IndexOf(r, id)] == s[IndexOf(s, id)] {
    var o := IndexOf(s, id);
    var ni := if o < k then o else o - 1;
    assert r[ni] == s[o];
    assert r[ni].id == id;
    assert IndexOf(r, id) >= 0 by { if IndexOf(r, id) < 0 { assert r[ni].id != id; } }
    assert r[IndexOf(r, id)].id == id;
    assert r[IndexOf(r, id)] == s[IndexOf(s, id)] by { UniqueEq(r, IndexOf(r, id), ni); }
  }
}

lemma UniqueEq(s: seq<Slot>, a: int, b: int)
  requires IdsUnique(s) && 0 <= a < |s| && 0 <= b < |s| && s[a].id == s[b].id
  ensures a == b
{ if a != b { if a < b { assert s[a].id != s[b].id; } else { assert s[b].id != s[a].id; } } }

// remove a slot. Removing the active one detaches (active becomes empty); the legacy fields keep their values, so the model in use
// does not change under the user's feet.
function Remove(st: St, id: string): St
  requires Valid(st)
  ensures Valid(Remove(st, id))
  ensures IndexOf(st.slots, id) < 0 ==> Remove(st, id) == st
  ensures IndexOf(st.slots, id) >= 0 ==> |Remove(st, id).slots| == |st.slots| - 1 && IndexOf(Remove(st, id).slots, id) < 0
  ensures Remove(st, id).model == st.model && Remove(st, id).req == st.req
  ensures id == st.active ==> Remove(st, id).active == ""
  ensures id != st.active && IndexOf(st.slots, id) >= 0 ==> Remove(st, id).active == st.active
{
  var k := IndexOf(st.slots, id);
  if k < 0 then st
  else
    RemoveAtUnique(st.slots, k);
    var r := RemoveAt(st.slots, k);
    assert IndexOf(r, id) < 0 by { if IndexOf(r, id) >= 0 { var m := IndexOf(r, id); assert r[m].id == id; var om := if m < k then m else m + 1; assert st.slots[om] == r[m]; UniqueEq(st.slots, om, k); } }
    if st.active == id then St(r, "", st.model, st.req)
    else if st.active == "" then St(r, "", st.model, st.req)
    else
      var oa := IndexOf(st.slots, st.active);
      assert oa != k by { if oa == k { assert st.slots[k].id == st.active; assert st.slots[k].id == id; } }
      St(r, st.active, st.model, st.req)
}

// pick a slot: an unknown id changes nothing
function Select(st: St, id: string): St
  requires Valid(st)
  ensures Valid(Select(st, id))
  ensures IndexOf(st.slots, id) < 0 ==> Select(st, id) == st
  ensures IndexOf(st.slots, id) >= 0 ==> Select(st, id).active == id && Select(st, id).slots == st.slots
{
  var k := IndexOf(st.slots, id);
  if k < 0 then st else Apply(st.slots[k], st)
}

// the user edits the model fields directly (settings page): if that no longer matches the active slot, detach it
function LegacyChanged(st: St, model: string, req: string): St
  requires |st.slots| <= MAX && IdsUnique(st.slots)
  requires st.active == "" || IndexOf(st.slots, st.active) >= 0
  ensures Valid(LegacyChanged(st, model, req))
  ensures LegacyChanged(st, model, req).model == model && LegacyChanged(st, model, req).req == req
{
  var n := St(st.slots, st.active, model, req);
  if n.active != "" && !Shows(n.slots[IndexOf(n.slots, n.active)], model, req) then St(st.slots, "", model, req) else n
}

// edit a slot's fields; if it is the active one, the legacy fields follow it
function EditSlot(st: St, id: string, name: string, model: string, req: string): St
  requires Valid(st)
  ensures Valid(EditSlot(st, id, name, model, req))
  ensures IndexOf(st.slots, id) < 0 ==> EditSlot(st, id, name, model, req) == st
  ensures |EditSlot(st, id, name, model, req).slots| == |st.slots|
{
  var k := IndexOf(st.slots, id);
  if k < 0 then st
  else
    var sl := Slot(id, name, model, req);
    var slots := st.slots[k := sl];
    assert IdsUnique(slots) by { forall i, j | 0 <= i < j < |slots| ensures slots[i].id != slots[j].id { if i == k { assert slots[i].id == id; } if j == k { assert slots[j].id == id; } } }
    var r := St(slots, st.active, st.model, st.req);
    assert slots[k].id == id;
    assert IndexOf(slots, id) >= 0;
    assert IndexOf(slots, id) == k by { UniqueEq(slots, IndexOf(slots, id), k); }
    if st.active == id then Apply(sl, r)
    else
      if st.active == "" then r
      else
        var oa := IndexOf(st.slots, st.active);
        assert oa != k by { if oa == k { assert st.slots[k].id == st.active; } }
        assert slots[oa] == st.slots[oa];
        assert IndexOf(slots, st.active) == oa by { UniqueEq(slots, IndexOf(slots, st.active), oa); }
        r
}

// ---- loading: any stored data becomes a Valid state ----------------------------------------------------------------------

lemma AppendUnique(kept: seq<Slot>, sl: Slot)
  requires IdsUnique(kept) && IndexOf(kept, sl.id) < 0
  ensures IdsUnique(kept + [sl])
{
  forall i, j | 0 <= i < j < |kept + [sl]| ensures (kept + [sl])[i].id != (kept + [sl])[j].id {
    if j == |kept| { assert (kept + [sl])[j] == sl; assert (kept + [sl])[i] == kept[i]; }
  }
}

// keep the first slot of each id, drop empty ids, stop at MAX
function DedupeCap(s: seq<Slot>, kept: seq<Slot>): seq<Slot>
  requires IdsUnique(kept) && |kept| <= MAX
  ensures IdsUnique(DedupeCap(s, kept)) && |DedupeCap(s, kept)| <= MAX
  decreases |s|
{
  if |s| == 0 then kept
  else if |kept| < MAX && s[0].id != "" && IndexOf(kept, s[0].id) < 0 then
    AppendUnique(kept, s[0]);
    DedupeCap(s[1..], kept + [s[0]])
  else DedupeCap(s[1..], kept)
}

function Normalize(stored: St): St
  ensures Valid(Normalize(stored))
{
  var slots := DedupeCap(stored.slots, []);
  var n := St(slots, stored.active, stored.model, stored.req);
  var k := IndexOf(slots, stored.active);
  if stored.active == "" || k < 0 || !Shows(slots[k], stored.model, stored.req) then St(slots, "", stored.model, stored.req) else n
}
