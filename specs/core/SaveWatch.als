// The database tree, the save blocks it is cut into (risuSave.ts RisuSaveEncoder) and the regions the autosave effects walk
// (saveWatch.svelte.ts). Every node belongs to one block; an effect "covers" a node when the node lies in the region it walks.
// Questions, for any shape of database Alloy can build in the scope:
//   Covered   - every node of the root block and of the selected character's block is walked by some effect that reports that
//               block (else an edit there is never saved)
//   Disjoint  - no node is walked by two effects (else one edit re-runs two walks; the card and its chats were one walk)
//   CardAlone - nothing under `chats` is in the card effect's region (a message never re-walks the card)
// for the fix (`split`) and for the cheaper split that walks only the open chat (`openOnly`).
abstract sig Node { parent: lone Node }
one sig Db extends Node {}
sig Key extends Node {}                       // a root key of the database
one sig Characters extends Key {}             // database.characters: its elements are their own blocks
sig Char extends Node {}                      // one character (a child of Characters)
one sig Selected extends Char {}              // the selected one
sig Field extends Node {}                     // a field of a character: the card's fields and `chats`
sig ChatsField extends Field {}               // `chats`
sig Chat extends Node {}                      // one chat, child of a ChatsField
lone sig Open extends Chat {}                 // the chat page shown
sig Inner extends Node {}                     // anything below (messages, lore entries, script state)

fact tree {
  no Db.parent
  all k: Key | k.parent = Db
  all c: Char | c.parent = Characters
  all f: Field | f.parent in Char
  all c: Chat | c.parent in ChatsField
  all i: Inner | i.parent in Key - Characters + Field - ChatsField + Chat + Inner
  no n: Node | n in n.^parent
  all c: Char | lone (ChatsField & parent.c)
  Open in parent.(ChatsField & parent.Selected)
}

fun under[n: Node]: set Node { n.*~parent }

abstract sig Block {}
one sig RootBlock, SelectedBlock, OtherBlock extends Block {}
fun blockOf[n: Node]: Block {
  n in under[Selected] => SelectedBlock
  else (n in under[Characters] => OtherBlock else RootBlock)
}

abstract sig Effect { reports: one Block, walks: set Node }
one sig RootEffect, CardEffect, ChatsEffect extends Effect {}
fact reportsWhat { RootEffect.reports = RootBlock and CardEffect.reports = SelectedBlock and ChatsEffect.reports = SelectedBlock }

// what the code walks: every root key but `characters`; the selected character's fields but `chats`; its chats
pred split {
  RootEffect.walks = under[Db] - Db - under[Characters]
  CardEffect.walks = under[Selected] - Selected - under[ChatsField & parent.Selected]
  ChatsEffect.walks = under[ChatsField & parent.Selected]
}
pred openOnly {
  RootEffect.walks = under[Db] - Db - under[Characters]
  CardEffect.walks = under[Selected] - Selected - under[ChatsField & parent.Selected]
  ChatsEffect.walks = (ChatsField & parent.Selected) + under[Open]
}

// the nodes an edit can change and the save writes for this page: below the root keys and below the selected character
fun editable: set Node { (under[Db] - Db - under[Characters]) + (under[Selected] - Selected) }

pred Covered { all n: editable | some e: Effect | n in e.walks and e.reports = blockOf[n] }
pred Disjoint { all disj a, b: Effect | no a.walks & b.walks }
pred CardAlone { no CardEffect.walks & under[ChatsField] }

assert SplitCovered { split => Covered }
assert SplitDisjoint { split => Disjoint }
assert SplitCardAlone { split => CardAlone }
assert OpenOnlyCovered { openOnly => Covered }
check SplitCovered for 7       // expect none
check SplitDisjoint for 7      // expect none
check SplitCardAlone for 7     // expect none
check OpenOnlyCovered for 7    // expect a counterexample: a message in a chat that is not open
run ShowSplit { split and some Open and some Inner & under[Open] and some (Chat - Open) & under[Selected] } for 7
