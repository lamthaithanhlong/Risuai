// How hard the story model thinks, by turn (asked 2026-10-16: fewer tokens, the same quality). The Custom API sends no
// reasoning effort, so the backend used its own default. Measured with the story model (gpt-6-sol) on 4 scenes x 3 replies:
//   default effort  920 output tokens a reply, 22 s;  low  402 tokens, 9 s; the same rubric faults (pronoun 3 / 2, POV 1 / 1)
//   blind pairwise judging, both orders: openings default 11 - 1 (it set up the world and kept to the player's "Có");
//   continuations low 9 - 3 (default leaked English editing notes into the story and wrote "Bà—cô")
// So the opening keeps the default and every later turn of the story asks for low effort. A reasoning_effort set by hand
// in Additional Parameters always wins.
// Then judged against the full lore and state (asked: does the thinking keep the story true to its lore?): lore and state
// faults the same in total (default 12, low 10 over 12 replies), but on Alternate Hunters, a card with required blocks in a
// fixed order, low put the "[💡Request Profile|…]" line last 2 of 6 times against 5 of 6 and changed EXP 50/200 twice. Such
// a card keeps the default on every turn with its own switch (character.fullReasoning).

/** The opening: the chat has no reply yet (the first message is not one of its messages; a reroll removes the reply first).
 *  Counted on the chat, not on the request, where a card's example dialogue also comes as assistant messages. */
export function isOpening(messages: { role: string }[] | undefined): boolean {
    return !(messages ?? []).some((m) => m.role === 'char')
}

/** The effort to ask of the story model, or undefined to leave the backend's default. `opening` undefined: not a story turn. */
export function storyEffort(opening: boolean | undefined, mode: string | undefined, on: boolean): 'low' | undefined {
    if (!on || opening === undefined || (mode ?? 'model') !== 'model') return undefined
    return opening ? undefined : 'low'
}
