// The hidden growth tags the narrator writes ([[ACT|id|stat+stat|difficulty|skills]], rarely [[BREAK|stat]]; the card's Lua and the client's
// stripStatTags take them out of the stored and the streamed text). Two things for the gate: how many tags the narrator wrote per run
// (report), and that no tag, finished or half-streamed, ever stays in what the player sees (a check; a fixture in finds.check.mjs makes it red).
const ACT = /\[\[ACT\|[^\]\n]*\]\]/g
const TRAIN = /\[\[TRAIN\|[^\]\n]*\]\]/g
const LEFT = /\[\[\s*(?:ACT|BREAK|TRAIN|KILL)\b|\bACT\|[a-z0-9_-]+\||\bTRAIN\|[a-z0-9_+-]+\||\bKILL\|[^\]\n]+\||\[\[(?:A|AC|B|BR|BRE|BREA|T|TR|TRA|TRAI|K|KI|KIL)(?:\s|$)/i

/** runs = [{ turns: [{ raw, shown }] }] -> [{ tags, turns }] per run: tags the model wrote (raw), story turns looked at */
export function actCounts(runs) {
    return (runs ?? []).map((run) => ({ turns: (run.turns ?? []).length, tags: (run.turns ?? []).reduce((n, t) => n + ((String(t.raw ?? '').match(ACT) ?? []).length), 0), train: (run.turns ?? []).reduce((n, t) => n + ((String(t.raw ?? '').match(TRAIN) ?? []).length), 0) }))
}

/** every place a tag (or the start of one) is left in the text the player saw, or in the stored reply */
export function actLeaks(runs) {
    const out = []
    ;(runs ?? []).forEach((run, r) => (run.turns ?? []).forEach((t, i) => {
        for (const [where, text] of [['shown', t.shown], ['stored', t.reply]]) {
            const m = LEFT.exec(String(text ?? ''))
            if (m) { const s = String(text); out.push({ rule: `act-visible-${where}`, text: `run ${r + 1} turn ${i + 1}: «${s.slice(Math.max(0, m.index - 20), m.index + 60).replace(/\s+/g, ' ')}»` }) }
        }
    }))
    return out
}

/** the two check objects (score.mjs shape) */
export function actChecks(runs) {
    const counts = actCounts(runs)
    const leaks = actLeaks(runs)
    return [
        { id: 'gate.actHidden', title: 'No [[ACT|…]] / [[BREAK|…]] / [[TRAIN|…]] / [[KILL|…]] tag stays in the displayed or stored text', status: runs.length && !leaks.length ? 'PASS' : 'FAIL', summary: leaks.length ? `${leaks.length} leak(s)` : `0 leaks over ${counts.reduce((n, c) => n + c.turns, 0)} story turns`, evidence: leaks.map((l) => `${l.rule}: ${l.text}`) },
        { id: 'gate.trainHidden', title: 'No [[TRAIN|…]] tag stays in the displayed or stored text (same scan as gate.actHidden, kept as its own line)', status: runs.length && !leaks.some((l) => /TRAIN|\[\[\s*T/i.test(l.text)) ? 'PASS' : 'FAIL', summary: leaks.some((l) => /TRAIN|\[\[\s*T/i.test(l.text)) ? 'TRAIN tag left in the text' : `0 TRAIN leaks; tags written: ${counts.map((c, i) => `run ${i + 1}: ${c.train}/${c.turns}`).join('; ') || 'none'}`, evidence: leaks.filter((l) => /TRAIN|\[\[\s*T/i.test(l.text)).map((l) => `${l.rule}: ${l.text}`) },
        { id: 'gate.actCount', title: 'ACT tags the narrator wrote per run (report only)', status: 'INFO', summary: counts.map((c, i) => `run ${i + 1}: ${c.tags}/${c.turns}`).join('; ') || 'no runs', evidence: [] },
    ]
}
