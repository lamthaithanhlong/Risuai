// The player's turn is carried out (reported 2026-10-16: "regenerated 4 lần vẫn không ra được ý cháu", for every story by the
// second try). The player had planned a shot at the stalactites over a monster; the ceiling had never been described, and the
// story answered "the ceiling is fitted stone slabs, there is no stalactite to shoot down", a detail invented to refuse the plan.
// Measured on that turn, six replies each: as it was, the plan carried out 0 of 6 (3 in part) and a contradicting detail
// invented 6 of 6; with this reminder 6 of 6 and 0. Across stories (Alternate Hunters, Lord of the Mysteries, a planned move
// using an object not yet described): 8 of 8 against 2 of 8. What is impossible is still refused: "I snap my fingers and the
// monster explodes" 6 of 6, "I close my eyes and become a god" 4 of 4. A power the story already gave the character still
// works (Alternate Hunters' hypnosis).

export const PLAYER_AGENCY = '\n\n[Player\'s turn: carry out what the player wrote, as written: their actions, aim and plan happen. A detail of the place they name'
    + ' that the story has not described yet (a stalactite in a cave, a loose stone) exists if it fits the setting; never invent a contradicting detail to'
    + ' refuse it. A prepared, plausible plan works; the world can make it costly or bring new trouble after, not cancel it. Only what is impossible in this'
    + ' world or contradicts what the story already showed fails, and then the narration shows why. Other people still decide for themselves: the player\'s'
    + ' words never decide what someone else feels, believes or chooses; that comes from the scene.]'

/** At the end of the player's message, where the model follows it (a system note alone is not read on this route). */
export function agencyRequest<T extends { role: string; content: unknown }>(formated: T[], on: boolean): T[] {
    if (!on) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + PLAYER_AGENCY } : m))
}
