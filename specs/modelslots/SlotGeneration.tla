---------------------------- MODULE SlotGeneration ----------------------------
(* A reply is generated with the model the legacy fields show when each request is BUILT. One generation can build more than one request:
   sendChat starts over after an empty reply or a guard retry (DefaultChatScreen sendChatMainRun with emptyRetry / guardRetry), and it
   re-reads the fields each time. Question: can one generation end up using two different models?
   GuardPicker  = TRUE : the chat menu's model picker is disabled while a reply is generated.
   GuardSetting = TRUE : the settings page's model fields are blocked while a reply is generated (the app does not do this).
   Snapshot     = TRUE : the generation takes the model once, when it starts, and every request of it (the retries too) uses that one.
                         This is what the app does (generationKey.ts keeps it and request.ts reads it), so neither guard is needed.
   Safety OneModelPerGeneration: all requests of a generation use the same model. *)
EXTENDS Naturals, FiniteSets, Sequences
CONSTANTS Models, GuardPicker, GuardSetting, Snapshot, MaxRetries
VARIABLES model,      \* the legacy aiModel field
          active,     \* the active slot's model, or "none"
          slots,      \* the models of the slots, as a set (at most 2 here)
          snap,       \* the model the running generation took at its start
          gen,        \* "idle" | "running"
          used,       \* the models of the requests built so far in this generation, as a set
          retries

vars == <<model, active, slots, snap, gen, used, retries>>

Init == /\ model \in Models /\ slots = {model} /\ active = model
        /\ snap = model /\ gen = "idle" /\ used = {} /\ retries = 0

\* picking a slot in the chat menu writes the legacy field
Pick(m) == /\ m \in slots /\ (~GuardPicker \/ gen = "idle")
           /\ model' = m /\ active' = m /\ UNCHANGED <<slots, snap, gen, used, retries>>
\* editing the model field in the settings page detaches the active slot if it no longer matches
Edit(m) == /\ m \in Models /\ (~GuardSetting \/ gen = "idle")
           /\ model' = m /\ active' = IF active = m THEN active ELSE "none"
           /\ UNCHANGED <<slots, snap, gen, used, retries>>
AddSlot(m) == /\ m \notin slots /\ Cardinality(slots) < 2 /\ slots' = slots \cup {m} /\ UNCHANGED <<model, active, snap, gen, used, retries>>

\* a generation: the first request, then retries; each request is built from the field as it is at that moment
Start == /\ gen = "idle" /\ gen' = "running" /\ used' = {model} /\ retries' = 0 /\ snap' = model /\ UNCHANGED <<model, active, slots>>
Retry == /\ gen = "running" /\ retries < MaxRetries /\ retries' = retries + 1
         /\ used' = used \cup {IF Snapshot THEN snap ELSE model}
         /\ UNCHANGED <<model, active, slots, snap, gen>>
Finish == /\ gen = "running" /\ gen' = "idle" /\ UNCHANGED <<model, active, slots, snap, used, retries>>

Next == (\E m \in Models : Pick(m) \/ Edit(m) \/ AddSlot(m)) \/ Start \/ Retry \/ Finish
Spec == Init /\ [][Next]_vars

OneModelPerGeneration == gen = "running" => Cardinality(used) = 1
\* the legacy field and the active slot agree, or no slot is active
Coherent == active = "none" \/ active = model
=============================================================================
