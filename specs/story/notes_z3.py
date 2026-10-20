# Which hidden notes ride on the player's message, as gameMasterPage.ts decides them (creationRequest + gameMasterRequest).
# Booleans are the facts the code reads; the formulas are copied from the code, so a counterexample is a real state.
from z3 import Bools, And, Or, Not, Solver, sat, Implies
import sys
fixed = '--fixed' in sys.argv
creationStep, panel, arc, past, yes, lastUser, asked, gmOn, persona, rule, storyLike, group, charReply, personaRule, replyAfterYes = Bools(
    'creationStep panel arc past yes lastUser asked gmOn persona rule storyLike group charReply personaRule replyAfterYes')
confirmed = Or(yes, panel, arc, past)
# gameMaster.ts creationNote: hasCreationStep && !hasPanel && !gm_arc && !gm_past && last user && no yes && asked
creation = And(Not(group), creationStep, Not(panel), Not(arc), Not(past), lastUser, Not(yes), asked)
# gmPhase: silent unless confirmed, or (no creation step and the replies look like story)
running = Or(confirmed, And(Not(creationStep), storyLike))
if not fixed:
    # gameMasterRequest: returns early when the GM is off (gameMasterOn) -> no persona, no plan note
    personaNote = And(Not(group), gmOn, confirmed, persona)   # (before: no card rule either)
    planNote = And(Not(group), gmOn, confirmed, rule)
else:
    # storyNotesRequest (gameMasterPage.ts): independent of the GM switch; on once confirmed, or on a card with no creation
    # step once a story reply exists
    notesOn = Or(confirmed, And(Not(creationStep), charReply))
    personaNote = And(Not(group), notesOn, persona, personaRule)
    planNote = And(Not(group), notesOn, rule)
def check(name, f):
    s = Solver(); s.add(f); s.add(Implies(storyLike, charReply))   # story-like replies are replies
    r = s.check()
    print(f'{name}: {"COUNTEREXAMPLE " + str(s.model()) if r == sat else "holds (unsat)"}')
    return r != sat
ok = True
initializing = And(yes, Not(replyAfterYes))
if fixed:
    initNote = And(Not(group), notesOn, personaRule, initializing)
    voiceNote = And(Not(group), notesOn, personaRule, Not(initializing))
    ok &= check('the Start note never with the creation note', And(creation, initNote))
    ok &= check('Start and Voice never together', And(initNote, voiceNote))
    ok &= check('the yes turn of a persona-rule card always gets Start', And(Not(group), personaRule, initializing, Not(initNote)))
ok &= check('creation note and a story note never together', And(creation, Or(personaNote, planNote)))
ok &= check('persona: the story runs on a persona-rule card with a persona, the note is there', And(Not(group), running, persona, personaRule, Not(personaNote)))
ok &= check('persona note only on a card whose rules ask for it', And(personaNote, Not(personaRule)))
ok &= check('plan: the story runs on a card with the rule, the note is there', And(Not(group), running, rule, Not(planNote)))
# never while the character is being made: a card with a creation step and nothing confirmed yet
making = And(creationStep, Not(confirmed))
ok &= check('no story note while the character is being made', And(making, Or(personaNote, planNote)))
# on a card with no creation step, from its first reply (the GM's storyLike needs panels, which such a card may never write)
if fixed:
    # the "already counted" note (statusBook.ts paidNote): the card has a panel, the chat an id, the last reply moved an amount;
    # it rides with the story notes, never on the yes turn (the panel is first filled there, nothing was paid)
    spec, chatId, moved = Bools('spec chatId moved')
    paid = And(Not(group), notesOn, Not(initializing), spec, chatId, moved)
    ok &= check('paid: never with the creation note', And(creation, paid))
    ok &= check('paid: never while the character is being made', And(making, paid))
    ok &= check('paid: never on the yes turn', And(initializing, paid))
    ok &= check('paid: the story runs and an amount moved, the note is there', And(Not(group), notesOn, Not(initializing), spec, chatId, moved, Not(paid)))
ok &= check('no creation step: the notes come with the first reply', And(Not(group), Not(creationStep), charReply, rule, Not(planNote)))
sys.exit(0 if ok else 1)
