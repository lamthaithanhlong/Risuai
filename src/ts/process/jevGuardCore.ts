// Pure Jev logic (no app state), so it can be unit-tested.

export interface JevQuestion {
    instructions: string
    // 'high' = the reply is bad when the probability is high; 'low' = bad when it is low
    bad: 'high' | 'low'
}

export const DRAW_QUESTION = 'worthDrawing'

export function buildQuestions(userName: string, opts: { guard: boolean, vietnamese: boolean, draw: boolean }): Record<string, JevQuestion> {
    const u = userName || 'the user'
    const q: Record<string, JevQuestion> = {}
    if (opts.guard) {
        q.speaksForUser = {
            instructions: `The user's own character in this roleplay is named "${u}". Does this reply invent new dialogue for ${u}, or decide ${u}'s actions, thoughts or feelings (more than briefly restating what ${u} already did)?`,
            bad: 'high',
        }
        q.outOfCharacter = {
            instructions: 'Does this reply break character: speak as an AI assistant, refuse, apologise, add meta commentary about the story, or stop roleplaying?',
            bad: 'high',
        }
        if (opts.vietnamese) {
            q.vietnamese = {
                instructions: 'Is the narration and dialogue of this reply written in Vietnamese (names, sound effects and HTML or markdown markup excepted)?',
                bad: 'low',
            }
        }
    }
    if (opts.draw) {
        q[DRAW_QUESTION] = {
            instructions: 'Is this story passage a visually striking or important scene worth an illustration (a new place, a character appearing or changing look, a dramatic, romantic or emotional peak, an action moment), rather than routine back-and-forth dialogue?',
            bad: 'low',
        }
    }
    return q
}

export interface JevVerdict {
    ok: boolean
    failed: string[]
    probs: Record<string, number>
}

/** Judges only the guard questions; the drawing question is not a fault in the reply. */
export function decide(probs: Record<string, number>, questions: Record<string, JevQuestion>, threshold: number): JevVerdict {
    const failed: string[] = []
    for (const [id, q] of Object.entries(questions)) {
        const p = probs[id]
        if (id === DRAW_QUESTION || typeof p !== 'number') {
            continue
        }
        if (q.bad === 'high' ? p >= threshold : p <= 1 - threshold) {
            failed.push(id)
        }
    }
    return { ok: failed.length === 0, failed, probs }
}

/** A missing answer means Jev could not judge, and an outage must never cost the user a picture. */
export function shouldDraw(probs: Record<string, number> | null, threshold: number): boolean {
    const p = probs?.[DRAW_QUESTION]
    return typeof p !== 'number' || p >= threshold
}

// Jev reads plain text; card regex/HTML and image placeholders would only spend its 4000-char window.
export function toState(reply: string): string {
    return reply
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<ImgGen="[^"]*">|{{ImgGen="[^"]*"}}|{{inlay::[^}]*}}|\[Generating\.\.\.\]/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000)
}
