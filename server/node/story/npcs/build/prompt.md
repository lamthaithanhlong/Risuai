# Drafting NPC psychology profiles (story/npcs/<world>.json, step 2 of the seed pipeline)

Used by the drafting model (one call per batch of 5 targets). The caller pastes the batch where `{{...}}` stands; build/merge.cjs
checks the answer (`merge.cjs <world> --check <draftDir>`) and returns the failures to be redrafted.

---

You profile characters of the story world **{{WORLD}}** for a game master engine. You may use ONLY the facts pasted below. No outside
knowledge of the books, films or games: if the pasted facts do not support a trait, stay near 50 for it and say nothing else.

## What you get

`TARGETS` is a list of up to 5 targets: `{id, name, aliases, importance, facts: [{fid, s, r, o, status, text, known_by}], lore: [lines], pairs}`.
`fid` is the index of that fact in the world's fact list. `status` is `fact` (true at the story's start), `unknown` (a question the
story keeps open), `rumor` (only said or believed) or `outdated` (was true once). `ALL_IDS` is every target id of this world (all
batches): the only people a relation may point at, besides `"player"`.

TARGETS:
{{TARGETS}}

ALL_IDS:
{{ALL_IDS}}

## What to answer

ONLY one JSON object, no prose, no code fence:

```json
{
  "npcs": [
    {
      "id": "<the target's id, unchanged>",
      "name": "<the target's name>",
      "aliases": ["<names it goes by>"],
      "importance": <the target's importance, copied>,
      "traits": { "open": 0-100, "consc": 0-100, "extra": 0-100, "agree": 0-100, "neuro": 0-100 },
      "speech": "cold | warm | blunt | formal | playful | timid | mocking | terse",
      "wants_to_say": "<=200 chars, or null",
      "wants_to_hide": "<=200 chars, or null",
      "hide_fid": <integer fid, or null>,
      "tags": ["<=5 of: loyal vengeful greedy protective ambitious pious cynical honest cowardly proud kind ruthless"],
      "source": "<book titles the facts came from, ';'-joined, or empty>"
    }
  ],
  "relations": [
    { "p": "<id of an npc in THIS answer>", "q": "<id from ALL_IDS, or \"player\">", "trust": 0-100, "affection": 0-100, "debt": 0-100, "grudge": 0-100, "why": "<=160 chars" }
  ],
  "skip": [ { "id": "<target id>", "why": "<short reason>" } ]
}
```

## Rules

1. **Individuals only.** Some targets are titles, ranks, groups, concepts or deities-as-forces, not one person ("Saint", "Void",
   "Beyonder", "His Majesty", "the Observer", "the character", "thời gian", "father", "Earl", "General"). Do not profile them: put
   `{"id", "why"}` in `skip` instead. A named person who also holds a title is an individual.
2. **Traits** (Big Five, integers 0..100, 50 = unknown or average): derive them from what the person DOES in the pasted facts. open =
   curious, unconventional; consc = disciplined, keeps promises; extra = sociable, loud; agree = kind, cooperative (low = hostile,
   selfish); neuro = anxious, reactive (high = easily shaken). Avoid all-50 and avoid all-extremes; most people sit 25..75 on most.
3. **speech**: exactly one word of the list, how they talk to a stranger.
4. **wants_to_say**: something this person would want to tell the player's character or push for, grounded in a pasted fact (a
   goal, a warning, a request). Plain statement, not a quote. null when the facts give nothing.
5. **wants_to_hide** — ONLY when a pasted fact of status `fact` or `unknown` about this person supports a secret (an identity, a
   crime, a loyalty, a weakness that other people in the story do not know: its `known_by` is short or empty). Then `hide_fid` is
   that fact's `fid`, and the text says what is hidden in one sentence. Never from a `rumor` or an `outdated` fact. No such fact:
   both `null`. They come together or not at all.
6. **tags**: up to 5 from the list, only ones the facts show.
7. **relations**: how each npc of THIS answer sees another target (in ALL_IDS) or `"player"`, at the **start of the story**:
   `trust` (will believe and rely on them), `affection` (warmth, liking), `debt` (feels they owe them), `grudge` (resentment, wants
   them to pay). One row per ordered pair that the facts speak of (family, enemies, allies, masters and servants); both directions are
   separate rows and may differ. Include a row toward `"player"` only for a person who starts out hostile or devoted to whoever the
   player is (a faction head, an enemy of the player's side); skip it otherwise: an absent row means "a stranger". At most 8 rows per
   npc. `p` is never equal to `q`; `q` is never a skipped id or an id outside ALL_IDS.
8. **why** is one short line naming the fact or relation behind the numbers.
9. Do not copy the player's own persona or invent people. Do not add keys not listed above.

If nothing fits a target at all, skip it.
