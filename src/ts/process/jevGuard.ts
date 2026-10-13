import { getDatabase, type character } from "../storage/database.svelte"
import { globalFetch } from "../globalApi.svelte"
import { buildQuestions, decide, shouldDraw, toState, type JevVerdict } from "./jevGuardCore"

// Jev (v1m System One, served by 9router at /v1/systemone) answers yes/no questions with probabilities.
// It cannot write prose, so it only judges a finished bot reply: the guard rerolls a failed reply,
// the image gate skips illustrations for routine turns. Both read the same single call per reply.

const cache = new Map<string, Promise<Record<string, number> | null>>()

function questionsFor(char: character | undefined) {
    const db = getDatabase()
    const cfg = db.jevGuard
    return buildQuestions(db.username, {
        guard: !!cfg?.enabled,
        vietnamese: !db.autoTranslate,
        draw: !!cfg?.imageGate && char?.viewScreen === 'imggen',
    })
}

/** null when Jev is off, the reply is empty, or Jev could not answer — an outage never blocks a reply. */
function judge(reply: string, char: character | undefined): Promise<Record<string, number> | null> {
    const db = getDatabase()
    const cfg = db.jevGuard
    const state = toState(reply)
    const questions = questionsFor(char)
    const ids = Object.keys(questions)
    if (!cfg?.url || !state || ids.length === 0) {
        return Promise.resolve(null)
    }
    const key = ids.join(',') + '\n' + state
    const hit = cache.get(key)
    if (hit) {
        return hit
    }
    const run = (async () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (db.proxyKey) {
            headers['Authorization'] = 'Bearer ' + db.proxyKey
        }
        const body = {
            model: cfg.model,
            state,
            questions: Object.fromEntries(ids.map((id) => [id, { type: 'noul', instructions: questions[id].instructions }])),
        }
        const res = await globalFetch(cfg.url, { body, headers, requestTimeoutMs: 15000 })
        if (!res.ok) {
            return null
        }
        const probs: Record<string, number> = {}
        for (const id of ids) {
            const a = res.data?.answers?.[id]
            if (a?.type === 'noul' && typeof a.noul === 'number') {
                probs[id] = a.noul
            }
        }
        return Object.keys(probs).length ? probs : null
    })()
    cache.set(key, run)
    while (cache.size > 20) {
        cache.delete(cache.keys().next().value)
    }
    return run
}

export async function jevCheck(reply: string, char: character): Promise<JevVerdict | null> {
    const cfg = getDatabase().jevGuard
    if (!cfg?.enabled) {
        return null
    }
    const probs = await judge(reply, char)
    return probs ? decide(probs, questionsFor(char), cfg.threshold) : null
}

export async function jevShouldDraw(reply: string, char: character): Promise<boolean> {
    const cfg = getDatabase().jevGuard
    if (!cfg?.imageGate) {
        return true
    }
    return shouldDraw(await judge(reply, char), cfg.imageThreshold)
}
