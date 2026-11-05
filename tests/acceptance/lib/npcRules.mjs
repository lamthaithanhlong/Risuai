// npc.dialogue, the deterministic rules (design .pm-risu-5h/npc-dialogue-algorithm.md §5, approved by L1 2026-11-05).
// The same checker the app runs (src/ts/process/npcCheck.mjs: the verified Accept, the grammar/telegraph regexes, the extractor),
// over a gate's story turns: each reply is read against the NPC cards folded from $led_npc as the PREVIOUS turn left it (the state
// before the reply). One rule per class: npc-grammar (1), npc-address (owner popup a), npc-quest-hook (2), npc-contradicts-need and
// npc-phantom-item (3), npc-exposition (4), npc-long (>2 sentences); npc-bare-request is soft (counted, never gating).
// The model judge (npcDialogue.mjs, stage 3) stays separate. REPORT-ONLY for the first 2 gates (status INFO) to measure false alarms;
// then { gate: true }: FAIL when any hard rule fires on more than maxRate (5%) of the NPC lines of the run set.
import { npcHits, npcLines, HARD_RULES } from '../../../src/ts/process/npcCheck.mjs'

/** the player's name from a record's persona line ("Kenji Park (nhân vật chính): …" -> "Kenji Park") */
export const playerOf = (persona) => String(persona ?? '').split(/[(:\n]/)[0].trim()

/**
 * Hits per story turn. turns: [{ shown|reply, raw (the model's reply, inner lines still in it), text (the player's message), vars (the chat vars after the turn: led_npc) }].
 * -> [{ turn, lines (NPC lines in the reply), hits: [{rule, text, npc, soft?, why?}] }]
 */
export function npcTurnHits(turns, { player = '' } = {}) {
    const out = []
    let ledger = ''
    for (const [i, t] of (turns ?? []).entries()) {
        const reply = t.shown || t.reply || ''
        // the raw reply still has the hidden [[NPC|…]] inner lines (the shown one does not): the inner-line clause reads them there
        const hits = npcHits(reply, { ledger, n: Infinity, player, playerText: t.text ?? '', raw: t.raw || reply })
        out.push({ turn: i, lines: npcLines(reply, { player }).length, hits })
        ledger = String(t.vars?.led_npc ?? t.vars?.$led_npc ?? ledger)
    }
    return out
}

/** The npc.dialogue check over a gate's runs: [{ turns }]. Report-only (INFO) unless gate is true. */
export function npcChecks(runs, { player = '', gate = false, maxRate = 0.05 } = {}) {
    const per = runs.map((r) => npcTurnHits(r.turns, { player }))
    const lines = per.flat().reduce((n, t) => n + t.lines, 0)
    const all = per.flatMap((p, ri) => p.flatMap((t) => t.hits.map((h) => ({ ...h, run: ri + 1, turn: t.turn + 1 }))))
    const count = (rule) => all.filter((h) => h.rule === rule).length
    const rules = [...HARD_RULES, 'npc-bare-request']
    const rate = (rule) => (lines ? count(rule) / lines : 0)
    const over = HARD_RULES.filter((r) => rate(r) > maxRate)
    const summary = `${lines} NPC lines; ` + rules.map((r) => `${r} ${count(r)}${lines ? ` (${Math.round(rate(r) * 100)}%)` : ''}`).join(', ') + (gate ? '' : ' (report only: first 2 gates measure false alarms)')
    return [{
        id: 'npc.dialogue',
        title: `NPC lines: grammar, address, no quest hook, no contradiction of their card, no unprompted motive, at most 2 sentences${gate ? '' : ' (report only)'}`,
        status: gate ? (over.length ? 'FAIL' : 'PASS') : 'INFO',
        summary,
        evidence: all.filter((h) => !h.soft || !gate).slice(0, 40).map((h) => `run ${h.run} turn ${h.turn} ${h.rule}${h.soft ? ' (soft)' : ''}: “${String(h.text).slice(0, 120)}”${h.why ? ` (${h.why})` : ''}`),
        counts: Object.fromEntries(rules.map((r) => [r, count(r)])), lines, over,
    }]
}
