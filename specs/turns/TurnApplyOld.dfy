// The page-owned turn's resume (pendingGenerationCore.ts planResume + DefaultChatScreen.svelte: chat.message.slice(0, keep)),
// against the property the server-owned turn keeps (TurnApply.dfy DropKeepsOthers): a run that starts again takes away only
// its own partial reply. Dafny REJECTS ResumeKeepsOthers: with the Mac's message after the phone's input (both pages on the chat),
// slice(0, previousLength) drops it. Expected: 1 error.
//
// Run: dafny verify TurnApplyOld.dfy   (fails on purpose)

datatype Msg = Msg(id: nat, user: bool)
predicate Has(c: seq<Msg>, id: nat) { exists j :: 0 <= j < |c| && c[j].id == id }

function ResumeOld(c: seq<Msg>, previousLength: nat): seq<Msg>
  requires previousLength <= |c|
{ c[..previousLength] }

lemma ResumeKeepsOthers(c: seq<Msg>, previousLength: nat, partialReply: nat)
  requires 1 <= previousLength <= |c| && c[previousLength - 1].user
  ensures forall x :: Has(c, x) && x != partialReply ==> Has(ResumeOld(c, previousLength), x)
{
}

// The resume note names the chat by index (pendingGenerationCore.ts PendingGeneration.chatPage). New Chat puts a chat first, so after
// a reload the index names another chat. Measured (tests/turns/repro.mjs kill): the resume answered chat 93be935b, the turn's own chat
// e1202c64 was left with an unanswered message. Dafny REJECTS ResumeTargetsTheTurnsChat. Expected: 1 more error (2 in all).
datatype Chat = Chat(id: nat, msgs: seq<Msg>)

lemma ResumeTargetsTheTurnsChat(cs: seq<Chat>, n: Chat, chatPage: nat)
  requires chatPage < |cs|
  ensures ([n] + cs)[chatPage].id == cs[chatPage].id
{
}
