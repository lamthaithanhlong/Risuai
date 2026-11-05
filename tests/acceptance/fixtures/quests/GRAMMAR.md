# Quest grammar (DRAFT, scored by lib/quests.mjs; the quest Lua should write exactly this)

The System offers quests; the System voice is `【HỆ THỐNG: …】` bracket lines (never a person: no "nói/cười/nhìn", no tớ/cậu, no Evelyn).

Chat variables (JSON text), read by the gate every turn:
- `$quest`: the ACTIVE quest, or "" when none (one at a time):
  `{"id":"q1","title":"…","state":"active","reward":{"kind":"stat","key":"the_luc","amount":100}}`
  `reward` is `{"kind":"stat","key":<suc_manh|nhanh_nhen|the_luc|tinh_than|cam_nhan|y_chi>,"amount":<hundredths>}` or `{"kind":"skill","id":<find id>,"amount":<hundredths>}`.
- `$quest_hist`: array of the CLOSED quests, oldest first: `{"id":"q1","state":"done"|"fail","reward":{…}}` (reward copied from the quest).

Visible, the turn the quest is offered (and the turn after at the latest): a System line containing `NHIỆM VỤ`, e.g.
`【HỆ THỐNG: NHIỆM VỤ — Tìm nguồn nước sạch trong tòa nhà.】`.
Keep `%` and `+0.0n` out of that line and out of the done line (stats.noLeak stays as it is); the amount lives in the store, shown as the usual tick line.

Hidden tags the narrator writes at the end of the reply (stripped from the shown and the stored text, like [[ACT]]):
`[[QUEST|done|<id>]]`   `[[QUEST|fail|<id>]]`   (only for the active quest; one tag per reply)

Scored (lib/quests.mjs): quest.offered (offered within 12 story turns, visible line, reward declared), quest.tracked (one active; every tag is for
the active quest and the store closes it; a closed quest had its tag), quest.rewarded (a done quest adds exactly `amount` to $stats[key] or
$skills[id].m, capped by the soft cap of the world rank / linked stat + 25, beyond that turn's ACT ticks; a failed quest adds nothing; at least one
done quest in the gate), quest.hidden (no `[[QUEST` left in shown or stored text).
