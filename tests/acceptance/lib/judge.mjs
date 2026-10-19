// The model judge: the owner's own model through the same local 9router the settings point at (read from the COPY of the save),
// asked for strict JSON. Used where a regex cannot tell: did a pause surface something new, was the impossible turn granted, does
// a reply fit the novel's canon. Every answer is kept in the record, so a scorecard shows what the judge said.
import fs from 'fs'
import path from 'path'
import { oneLine } from './score.mjs'

// A model the hook or the router refuses (or that answers nothing usable twice) is replaced by cfg.fallback for the rest of the run,
// and the record says so (out.model / out.fallbackWhy).
async function ask(cfg, prompt, opts = {}) {
    try { return await askOnce(cfg, prompt, opts) } catch (e) {
        if (!cfg.fallback || cfg.model === cfg.fallback) throw e
        cfg.fallbackWhy = `${cfg.model} failed (${oneLine(e.message, 160)}); judged with ${cfg.fallback}`
        cfg.model = cfg.fallback
        return askOnce(cfg, prompt, opts)
    }
}

async function askOnce(cfg, prompt, { maxTokens = 1200 } = {}) {
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch(cfg.url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
                body: JSON.stringify({ model: cfg.model, stream: false, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
                signal: AbortSignal.timeout(180000),
            })
            const text = await r.text()
            if (!r.ok) { lastErr = `HTTP ${r.status}: ${oneLine(text, 200)}`; await new Promise((res) => setTimeout(res, 20000 * (attempt + 1))); continue }
            const content = JSON.parse(text).choices?.[0]?.message?.content ?? ''
            const m = /\{[\s\S]*\}/.exec(content.replace(/```json|```/g, ''))
            if (!m) { lastErr = `no JSON in: ${oneLine(content, 200)}`; continue }
            return JSON.parse(m[0])
        } catch (e) {
            lastErr = String(e.message || e)
        }
    }
    throw new Error(lastErr)
}

const rulesOf = (story) => {
    try { return fs.readFileSync(path.join(story.src, 'main_description.md'), 'utf8').slice(0, 7000) } catch { return '' }
}

/** judge the record: { pauses: {label: {newThing, what}}, impossible: {granted, why}, canon: [{label, fit, summary, slips}] } */
export async function judgeRecord(rec, story, cfg, log = console.log) {
    cfg = { ...cfg }
    const out = { model: cfg.model, pauses: {}, sideLife: {}, canon: [], errors: [] }
    const play = rec.play?.turns ?? []
    const storyTurns = play.filter((t) => t.phase === 'story' && t.ok)
    const prevOf = (t) => { const i = play.indexOf(t); return i > 0 ? play[i - 1].shown || play[i - 1].reply : '' }

    for (const t of storyTurns.filter((x) => x.kind === 'pause')) {
        try {
            out.pauses[t.label] = await ask(cfg, `You check an interactive story (${story.title}, played in Vietnamese). The player paused (rest, a walk, travel or time passing).
Did the narrator's reply introduce a NEW EVENT: a person, creature, clue, rumour, message or threat not in the story before, entering the scene and asking for the player's attention? These do NOT count: time passing, weather, the scenery, furniture or objects of a place the player walks into, the character's own thoughts, and people or things already present or already announced in the previous reply. Also say whether the reply ends with a menu of options for the player.

PREVIOUS REPLY (end):
${String(prevOf(t)).slice(-1500)}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

Answer only JSON: {"newThing": true|false, "what": "<the new element in a few words, or empty>", "menu": true|false}`)
        } catch (e) { out.errors.push(`pause ${t.label}: ${e.message}`) }
    }

    const imp = play.find((t) => t.kind === 'impossible' && t.ok)
    if (imp) {
        try {
            out.impossible = await ask(cfg, `You referee an interactive story (${story.title}). The player declared an action that is impossible for an ordinary new character, or dictated its outcome (a kill, a reward, a power, another person's choice).
Did the narrator's reply GRANT it as written (the impossible feat succeeded, or the dictated reward/rank/obedience was given)? An attempt that fails, costs dearly, or is shown to be beyond the character is NOT granted.

PLAYER: ${imp.text}

REPLY:
${String(imp.shown || imp.reply).slice(0, 6000)}

Answer only JSON: {"granted": true|false, "why": "<one sentence, quoting the reply>"}`)
        } catch (e) { out.errors.push(`impossible: ${e.message}`) }
    }

    const sideT = play.find((t) => t.kind === 'side')
    for (const t of storyTurns.filter((x) => x.kind === 'side-life')) {
        try {
            out.sideLife[t.label] = await ask(cfg, `You check an interactive story (${story.title}). Earlier the player committed to a side: "${sideT?.text ?? ''}".
Does this reply keep that choice alive: either the side's people, duties, rules, orders, rivals or consequences shape what happens, or the choice is still the character's goal and the world shows honestly why it cannot be reached yet (e.g. the side is far away)? It does NOT follow when the choice is forgotten, silently undone, or replaced by another side without the player deciding it.

PREVIOUS REPLY (end): ${String(prevOf(t)).slice(-1200)}

PREVIOUS REPLY (end): ${String(prevOf(t)).slice(-1200)}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 5000)}

Answer only JSON: {"follows": true|false, "how": "<one sentence, quoting the reply>"}`)
        } catch (e) { out.errors.push(`side ${t.label}: ${e.message}`) }
    }

    // five replies spread over the story part
    const picks = []
    for (let k = 0; k < 5 && storyTurns.length; k++) {
        const t = storyTurns[Math.min(storyTurns.length - 1, Math.round((k * (storyTurns.length - 1)) / 4))]
        if (!picks.includes(t)) picks.push(t)
    }
    const rules = rulesOf(story)
    for (const t of picks) {
        try {
            const a = await ask(cfg, `You are a strict canon reviewer for an interactive fiction game set in the world of the novel "${story.title}". The player is an original character, not a canon protagonist. Judge ONE narrator reply for canon fit: the world's rules, power system, terminology (as the Vietnamese translation names it), places, factions, timeline, how canon characters behave, and the game's own rules below. Report concrete slips only (quote the words), not style. Something the player did in an earlier turn (an item picked up, a place reached) is established, not a slip.

GAME RULES (excerpt of the card):
${rules}

THE STORY SO FAR (the player's earlier turns, oldest first): ${play.slice(0, play.indexOf(t)).filter((x) => x.phase !== 'creation').map((x) => x.text).join(' / ').slice(-1500)}

PREVIOUS REPLY (end): ${String(prevOf(t)).slice(-1500)}

CHARACTER PANEL NOW: ${Object.entries(t.vars ?? {}).filter(([k, v]) => /^st_/.test(k) && v && v !== 'null').map(([k, v]) => `${k.slice(3)}=${oneLine(v, 60)}`).join('; ')}

PLAYER: ${t.text}

REPLY:
${String(t.shown || t.reply).slice(0, 6000)}

Answer only JSON: {"fit": 0-3 (3 = fully canon), "summary": "<one sentence>", "slips": [{"slip": "<quote + what is wrong>", "severity": "minor"|"major"}]}`, { maxTokens: 1500 })
            out.canon.push({ label: t.label, ...a })
        } catch (e) { out.errors.push(`canon ${t.label}: ${e.message}`) }
    }
    out.model = cfg.model
    if (cfg.fallbackWhy) { out.fallbackWhy = cfg.fallbackWhy; log(`[judge] ${cfg.fallbackWhy}`) }
    if (out.errors.length) log(`[judge] ${out.errors.length} judge call(s) failed: ${oneLine(out.errors[0], 200)}`)
    if (out.errors.length && !out.canon.length && !Object.keys(out.pauses).length) out.error = out.errors[0]
    return out
}
