---------------------------- MODULE ChatSlot ----------------------------
(* sendChat (index.svelte.ts) captures selectedChar / selectedChat once, then awaits for seconds or minutes (memory, the model
   request, streaming) and writes the reply to DBState.db.characters[selectedChar].chats[selectedChat].
   The sidebar "New Chat" button does chats.unshift(...) and a chat can be deleted, both while the reply is being generated,
   so the captured index can point at another chat.
   ByIndex = TRUE : the shipped behaviour.  ByIndex = FALSE : the slot follows the chat's id.
   Safety: the reply is written only into the chat it was generated for. *)
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS MaxChats, ByIndex
VARIABLES chats,    \* the chat list, as chat ids, front first
          target,   \* id of the chat being generated for
          idx,      \* the index captured when generation started (1-based)
          pc,       \* "idle" | "generating" | "done"
          landed,   \* ids of the chats that received the reply
          fresh

vars == <<chats, target, idx, pc, landed, fresh>>

Init == /\ chats = <<1, 2>> /\ target = 1 /\ idx = 1 /\ pc = "generating" /\ landed = {} /\ fresh = 3

\* the user, while the reply is generated
NewChat == /\ Len(chats) < MaxChats /\ chats' = <<fresh>> \o chats /\ fresh' = fresh + 1
           /\ UNCHANGED <<target, idx, pc, landed>>
DeleteChat(j) == /\ j \in 1..Len(chats) /\ Len(chats) > 1
                 /\ chats' = SubSeq(chats, 1, j - 1) \o SubSeq(chats, j + 1, Len(chats))
                 /\ UNCHANGED <<target, idx, pc, landed, fresh>>

IndexOf(id) == IF \E i \in 1..Len(chats) : chats[i] = id THEN CHOOSE i \in 1..Len(chats) : chats[i] = id ELSE 0

\* the write after the await
Write == /\ pc = "generating" /\ pc' = "done"
         /\ LET pos == IF ByIndex THEN idx ELSE IndexOf(target)
            IN IF pos \in 1..Len(chats) THEN landed' = {chats[pos]} ELSE landed' = {}
         /\ UNCHANGED <<chats, target, idx, fresh>>

Next == NewChat \/ (\E j \in 1..Len(chats) : DeleteChat(j)) \/ Write
Spec == Init /\ [][Next]_vars

\* keeps the state space finite: at most 3 chats are ever created while the reply is generated
Bound == fresh <= 6

\* the reply never lands in a chat it was not generated for
Safe == landed \subseteq {target}
=============================================================================
