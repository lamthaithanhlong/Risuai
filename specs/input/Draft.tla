---- MODULE Draft ----
\* The chat screen's input box (DefaultChatScreen.svelte, chatDraft.ts, dictation.ts), 2026-10-22: one box for whichever chat is open;
\* the player types, dictates (mic on, mic off, the Mac transcribes, the words come back later), switches chats, sends (the send awaits
\* a command, the turn check, a trigger and a script before it takes the text), and a reply generates (retried or resumed later).
\* Words are numbered; origin[w] is the chat a word was typed or spoken for.
\*
\* The switches are the code's fixes, each one a constant: all FALSE is the code before (Draft_OLD.cfg), all TRUE the code after
\* (Draft_FIXED.cfg).
\*   PerChat     a switch stores the box under its chat and shows the new chat's draft (drafts.open)
\*   Tag         a dictation is tagged with the chat it started in and its words go there (createDictation tag, drafts.deliver)
\*   Capture     sendMain takes the text and its chat before the awaits, and stops if that chat is no longer open
\*   NoRetryWipe sendChatMainRun no longer clears the box (a retry or a resumed reply ran it with another chat's draft in the box)
\*   KeepTyped   a send takes out only the words it sent; words typed or dictated during its awaits stay
\*   SendGuard   one send at a time (a second tap during the awaits sent the same text twice)
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS Chats, N, PerChat, Tag, Capture, NoRetryWipe, KeepTyped, SendGuard

None == "none"
Words == 1..N

VARIABLES open, box, store, origin, made, mic, micTag, flight, sentTo, sentCount, gen
vars == <<open, box, store, origin, made, mic, micTag, flight, sentTo, sentCount, gen>>

Init ==
    /\ open \in Chats
    /\ box = {}
    /\ store = [c \in Chats |-> {}]
    /\ origin = [w \in Words |-> None]
    /\ made = 0
    /\ mic = "idle"
    /\ micTag = None
    /\ flight = <<>>
    /\ sentTo = {}
    /\ sentCount = [w \in Words |-> 0]
    /\ gen = FALSE

New(w, c) == origin' = [origin EXCEPT ![w] = c] /\ made' = w

Type ==
    /\ made < N
    /\ New(made + 1, open)
    /\ box' = box \cup {made + 1}
    /\ UNCHANGED <<open, store, mic, micTag, flight, sentTo, sentCount, gen>>

MicStart ==
    /\ mic = "idle"
    /\ mic' = "rec"
    /\ micTag' = open
    /\ UNCHANGED <<open, box, store, origin, made, flight, sentTo, sentCount, gen>>

MicStop ==
    /\ mic = "rec"
    /\ mic' = "trans"
    /\ UNCHANGED <<open, box, store, origin, made, micTag, flight, sentTo, sentCount, gen>>

\* the transcription comes back, maybe after a switch
SttDone ==
    /\ mic = "trans"
    /\ made < N
    /\ New(made + 1, micTag)
    /\ mic' = "idle"
    /\ IF Tag /\ micTag # open
         THEN store' = [store EXCEPT ![micTag] = @ \cup {made + 1}] /\ box' = box
         ELSE box' = box \cup {made + 1} /\ store' = store
    /\ UNCHANGED <<open, micTag, flight, sentTo, sentCount, gen>>

Switch(c) ==
    /\ c # open
    /\ open' = c
    /\ IF PerChat
         THEN box' = store[c] /\ store' = [store EXCEPT ![open] = box, ![c] = {}]
         ELSE box' = box /\ store' = store
    /\ UNCHANGED <<origin, made, mic, micTag, flight, sentTo, sentCount, gen>>

\* the send button: the send starts awaiting (a command, the turn check, a trigger, a script)
SendStart ==
    /\ ~gen
    /\ Len(flight) < 2
    /\ (SendGuard => flight = <<>>)
    /\ flight' = Append(flight, [from |-> open, text |-> box])
    /\ UNCHANGED <<open, box, store, origin, made, mic, micTag, sentTo, sentCount, gen>>

Sent(ws, c) ==
    /\ sentTo' = sentTo \cup {<<w, c>> : w \in ws}
    /\ sentCount' = [w \in Words |-> IF w \in ws THEN sentCount[w] + 1 ELSE sentCount[w]]

\* the awaits are over: the message goes into the chat the send started in (cha, captured at the start, in both versions)
SendFinish ==
    /\ flight # <<>>
    /\ LET s == Head(flight) IN
         /\ flight' = Tail(flight)
         /\ IF Capture
              THEN IF open = s.from
                     THEN /\ Sent(s.text, s.from)
                          /\ box' = IF KeepTyped THEN box \ s.text ELSE {}
                          /\ gen' = TRUE
                     ELSE UNCHANGED <<box, sentTo, sentCount, gen>>
              \* before: messageInput read after the awaits, whatever chat it belongs to by then, then cleared
              ELSE /\ Sent(box, s.from)
                   /\ box' = {}
                   /\ gen' = TRUE
    /\ UNCHANGED <<open, store, origin, made, mic, micTag>>

\* a reply retried (empty stream) or resumed after a reload runs sendChatMainRun again
GenRetry ==
    /\ gen
    /\ box' = IF NoRetryWipe THEN box ELSE {}
    /\ UNCHANGED <<open, store, origin, made, mic, micTag, flight, sentTo, sentCount, gen>>

GenEnd ==
    /\ gen
    /\ gen' = FALSE
    /\ UNCHANGED <<open, box, store, origin, made, mic, micTag, flight, sentTo, sentCount>>

Next == Type \/ MicStart \/ MicStop \/ SttDone \/ (\E c \in Chats : Switch(c)) \/ SendStart \/ SendFinish \/ GenRetry \/ GenEnd

Spec == Init /\ [][Next]_vars

\* the box shows only the open chat's words
BoxOwned == \A w \in box : origin[w] = open
\* a stored draft holds only its own chat's words
StoreOwned == \A c \in Chats : \A w \in store[c] : origin[w] = c
\* a word is sent only into the chat it was written for
SentOwned == \A p \in sentTo : origin[p[1]] = p[2]
\* a word is never sent twice
SentOnce == \A w \in Words : sentCount[w] <= 1
\* a word nobody sent is still somewhere: the box or a draft
NoLoss == \A w \in Words : origin[w] # None => (w \in box \/ (\E c \in Chats : w \in store[c]) \/ sentCount[w] > 0)
====
