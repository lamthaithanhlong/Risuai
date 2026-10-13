// The single-generation slot (src/ts/process/generationKey.ts: beginGeneration / endGeneration / nextJobKey).
// Before it, a second sendChatMain overwrote the key and counter of the running one and its tail cleared them.

datatype Slot = Slot(holder: int, counter: int)   // holder -1 = free

function Begin(s: Slot, key: int): (Slot, bool)
  requires key >= 0
{
  if s.holder != -1 then (s, false) else (Slot(key, 0), true)
}

function End(s: Slot, key: int): Slot
{
  if s.holder == key then Slot(-1, 0) else s
}

// A failed begin changes nothing: the running generation keeps its key and counter.
lemma LoserChangesNothing(s: Slot, key: int)
  requires key >= 0 && s.holder != -1
  ensures Begin(s, key) == (s, false)
{
}

// A late end from a generation that does not hold the slot changes nothing.
lemma LateEndIsNoOp(s: Slot, key: int)
  requires s.holder != key
  ensures End(s, key) == s
{
}

// The holder is the only one that frees the slot, and after that a new generation can begin from counter 0.
lemma HolderFreesAndNextStartsClean(s: Slot, key: int, next: int)
  requires key >= 0 && next >= 0 && s.holder == key
  ensures var s2 := End(s, key); s2.holder == -1 && Begin(s2, next) == (Slot(next, 0), true)
{
}

// At most one generation holds the slot at any time: a successful begin implies the slot was free.
lemma AtMostOneHolder(s: Slot, key: int)
  requires key >= 0
  ensures Begin(s, key).1 ==> s.holder == -1 && Begin(s, key).0.holder == key
{
}
