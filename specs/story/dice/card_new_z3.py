"""The card's fate die (Module 10: "1-20 means something new surfaces ... Never two new events in a row") and the app's note
(gameMasterPage.ts gameMasterRequest: cardEvent -> "Card fate die: NEW EVENT ... it overrides a QUIET or BUILD pace").
Requests are made at a reply count n; a reroll asks again at the same n, the next turn at n + 1. The reply that stays at n is
the one from the last request made there. Property: no two replies in a row that stay were both told NEW.

  python3 card_new_z3.py          # the app before the fix: the note follows the die alone (expect a counterexample)
  python3 card_new_z3.py --fixed  # cardNewMark: a NEW right after a NEW stays quiet; a reroll goes back to the mark before
"""
import sys
from z3 import And, Bool, BoolVal, If, Implies, Int, Not, Or, Solver, sat

FIXED = '--fixed' in sys.argv
K = 7  # requests
s = Solver()
n = [Int(f'n{k}') for k in range(K)]
die_new = [Bool(f'd{k}') for k in range(K)]  # the card's die this request said NEW (1-20)
told = [Bool(f't{k}') for k in range(K)]
at = [Int(f'at{k}') for k in range(K + 1)]    # $gm_new_at before request k (-1 none)
prev = [Int(f'pv{k}') for k in range(K + 1)]  # $gm_new_prev
s.add(n[0] == 0, at[0] == -1, prev[0] == -1)
for k in range(K):
    if k: s.add(Or(n[k] == n[k - 1], n[k] == n[k - 1] + 1))
    # the mark as it stands for this reply: a reroll at the marked reply looks at the mark before it
    last = If(at[k] == n[k], prev[k], at[k])
    if FIXED:
        s.add(told[k] == And(die_new[k], last != n[k] - 1))
        s.add(at[k + 1] == If(told[k], n[k], last), prev[k + 1] == If(told[k], last, If(at[k] == n[k], -1, prev[k])))
    else:
        s.add(told[k] == die_new[k], at[k + 1] == at[k], prev[k + 1] == prev[k])
# the request that made the reply kept at reply count n is the last one at that n
def kept(k):
    return BoolVal(True) if k == K - 1 else n[k + 1] != n[k]
bad = Or(*[And(kept(i), kept(j), n[j] == n[i] + 1, told[i], told[j]) for i in range(K) for j in range(i + 1, K)])
s.add(bad)
r = s.check()
if r == sat:
    m = s.model()
    print('two NEW in a row: counterexample (sat)')
    print('  ', ' '.join(f"n={m[n[k]]}{'*' if m.eval(told[k]) else ''}" for k in range(K)), '(* told NEW)')
else:
    print('two NEW in a row: holds (unsat)')
# and the fix never silences a NEW that did not follow one: a NEW kept after a quiet kept reply is still told
s2 = Solver(); s2.add(s.assertions()[:-1])
lost = Or(*[And(kept(i), kept(j), n[j] == n[i] + 1, Not(told[i]), die_new[j], Not(told[j])) for i in range(K) for j in range(i + 1, K)])
s2.add(lost)
print('a NEW after a quiet reply silenced:', 'counterexample (sat)' if s2.check() == sat else 'holds (unsat)')
