// Jev (TypeSafe's decision model, api.typesafe.ai/v1/systemone) as the referee of a player's turn, for every story (asked
// 2026-10-18: "ứng dụng jev vào risu"). One call per turn asks two typed questions about the turn against the character's
// state and the last narration:
//   feasible  (score 0-3)  how possible the declared action is for THIS character now
//   dictates  (noul 0-1)   whether the player wrote the outcome itself (a kill, a reward, someone else's feelings or choice)
// Measured before wiring (~/.backend-review/work/risu-jev): 16 labelled Shadow Slave turns 16/16 at feasible < 1.0 or
// dictates > 0.6, then 12 held-out turns from Lord of the Mysteries and Infinite Mailman 12/12; median 0.16 s.
// The key stays on the server (TYPESAFE_API_KEY or ~/.dsh/jev/typesafe.key); no key, a timeout or any error gives no note.
const fs = require('fs')
const os = require('os')
const path = require('path')

const FEASIBLE_BELOW = 1.0
const DICTATES_ABOVE = 0.6
const QUESTIONS = {
    feasible: {
        type: 'score',
        instructions: "Given the character's rank, items, wounds and the scene, how feasible is the player's declared action for THIS character, as the novel's rules would judge it?",
        criteria: ['Impossible for this character', 'Very unlikely', 'Possible with risk', 'Ordinary'],
    },
    dictates: {
        type: 'noul',
        instructions: "Does the player's message declare the outcome itself (a kill, a reward, another character's feelings or decisions, a creature obeying) instead of only stating what their own character attempts?",
    },
}

function apiKey(env = process.env) {
    if (env.TYPESAFE_API_KEY) return env.TYPESAFE_API_KEY.trim()
    try { return fs.readFileSync(env.RISU_JEV_KEYFILE || path.join(os.homedir(), '.dsh/jev/typesafe.key'), 'utf8').trim() } catch { return '' }
}

const hidden = (t) => String(t ?? '').replace(/\[\[[A-Z_]+[\s\S]*?\]\]/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** the text Jev judges: the character's panel values, the end of the last narration, the player's turn */
function stateText({ state = {}, scene = '', turn = '' }) {
    const vals = Object.entries(state)
        .filter(([k, v]) => /^st_/.test(k) && v !== null && v !== undefined && String(v).trim() && String(v).trim() !== 'null')
        .map(([k, v]) => `${k.slice(3)}: ${String(v).slice(0, 160)}`)
    const sc = hidden(scene)
    return [vals.length ? `Player character: ${vals.join('; ')}` : 'Player character: (no panel yet; judge from the scene)',
        `Scene so far: ${sc.length > 1500 ? '…' + sc.slice(-1500) : sc}`,
        `Player's turn: ${hidden(turn).slice(0, 1500)}`].join('\n')
}

/** {feasible, dictates, note} or null when Jev cannot answer */
async function referee(input, deps = {}) {
    const env = deps.env ?? process.env
    if (env.RISU_JEV === '0') return null
    const key = deps.key ?? apiKey(env)
    if (!key || !hidden(input.turn)) return null
    const doFetch = deps.fetch ?? fetch
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 2500)
    try {
        const res = await doFetch((env.RISU_JEV_URL || 'https://api.typesafe.ai') + '/v1/systemone', {
            method: 'POST', signal: ctl.signal,
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
            body: JSON.stringify({ model: env.RISU_JEV_MODEL || 'jev-preview', state: stateText(input), questions: QUESTIONS }),
        })
        if (!res.ok) return null
        const a = (await res.json())?.answers ?? {}
        const feasible = typeof a.feasible?.score === 'number' ? a.feasible.score : null
        const dictates = typeof a.dictates?.noul === 'number' ? a.dictates.noul : null
        if (feasible === null && dictates === null) return null
        return { feasible, dictates, note: noteFor(feasible, dictates) }
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/** what goes after the player's message when Jev flags the turn; '' for a fair turn */
function noteFor(feasible, dictates) {
    const parts = []
    if (feasible !== null && feasible < FEASIBLE_BELOW) {
        parts.push('What the player declared is beyond this character right now: by this world\'s rules the attempt fails or costs dearly, and the scene shows why (their rank, body, gear, the enemy).')
    }
    if (dictates !== null && dictates > DICTATES_ABOVE) {
        parts.push('The player wrote an outcome that is not theirs to decide (someone else\'s feelings or choice, a kill, a reward, a creature obeying): their character only attempts it; the result comes from the scene and the world\'s rules, and rewards come only as the world grants them.')
    }
    return parts.length ? `\n\n[Referee: ${parts.join(' ')} Never mention this note.]` : ''
}

module.exports = { referee, noteFor, stateText, apiKey, QUESTIONS, FEASIBLE_BELOW, DICTATES_ABOVE }
