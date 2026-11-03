// Scorers for the narrator's own output that need no model (L1 gate, 2026-11-03): the Evelyn bugs the owner flagged in real chats.
// Each one has to go red on the owner's exported chats under fixtures/owner-chats (score.check.mjs breaks them on purpose).

/** An export file ("--Name\n text" blocks) as turns. The first block's header is the narrator's; any other header is the player. */
export function parseExport(text) {
    const blocks = String(text ?? '').split(/^--(?=\S)/m).slice(1).map((b) => { const i = b.indexOf('\n'); return { head: b.slice(0, i).trim(), text: b.slice(i + 1).trim() } })
    const narrator = blocks[0]?.head
    return blocks.map((b) => ({ who: b.head === narrator ? 'narrator' : 'player', text: b.text }))
}

const EMOJI_OPEN = /^[\s*_>]*\p{Extended_Pictographic}/u
const SETUP = [/chỉ mình (anh|cậu|Kenji) (mới )?(thấy|nghe)/i, /(là )?người bạn thân đã (mất|qua đời) của/i, /chỉ (anh|cậu|Kenji) (mới )?(thấy|nghe) (và nghe )?được (cô|Evelyn)/i]
const LEAK = [/\[💡/, /\[\[LOOK\b/]

const tokens = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
const sentences = (s) => String(s).split(/(?<=[.!?…”"])\s+|\n+/).map((x) => x.trim()).filter((x) => tokens(x).length >= 6)
/** Tokens in common over the shorter sentence. */
export function overlap(a, b) {
    const A = tokens(a), B = tokens(b)
    const set = new Set(B)
    const common = A.filter((t) => set.has(t)).length
    return common / Math.min(A.length, B.length)
}

/**
 * Problems in the narrator's replies (strings, in order): the setup explained to the player, an emoji opening a paragraph in more than a
 * third of the replies (the owner's chats had it in 2 of 2 and 2 of 3; counted per reply because per paragraph a reply of five
 * paragraphs with one emoji never reads as too many), two consecutive replies sharing a sentence (>= 60% of its tokens), and
 * [💡…] / [[LOOK text left in the prose.
 */
export function narrationProblems(replies) {
    const out = []
    const rs = replies.map((r) => String(r ?? ''))
    rs.forEach((r, i) => {
        for (const re of SETUP) { const m = re.exec(r); if (m) { out.push({ rule: 'setup', reply: i, text: m[0] }); break } }
        for (const re of LEAK) { const m = re.exec(r); if (m) out.push({ rule: 'leak', reply: i, text: m[0] }) }
    })
    const withEmoji = rs.map((r, i) => (r.split(/\n\s*\n/).some((p) => EMOJI_OPEN.test(p)) ? i : -1)).filter((i) => i >= 0)
    if (rs.length >= 2 && withEmoji.length > rs.length / 3) out.push({ rule: 'emoji', reply: withEmoji[0], text: `${withEmoji.length}/${rs.length} replies open a paragraph with an emoji` })
    for (let i = 1; i < rs.length; i++) {
        const prev = sentences(rs[i - 1])
        for (const s of sentences(rs[i])) {
            const hit = prev.find((p) => overlap(p, s) >= 0.6)
            if (hit) { out.push({ rule: 'repeat', reply: i, text: s.slice(0, 100) }); break }
        }
    }
    return out
}

/** The creation record must carry every companion the persona names, and must not say "Đồng hành: Không" while it names one. */
export function companionProblems(record, companions) {
    const out = []
    const r = String(record ?? '')
    const line = r.split('\n').find((l) => /đồng hành/i.test(l)) ?? ''
    if (!line) out.push({ rule: 'no-line', text: 'the record has no Đồng hành line' })
    for (const c of companions) if (!r.toLowerCase().includes(c.toLowerCase())) out.push({ rule: 'missing', text: `${c} is not in the record` })
    if (!companions.length && line && !/đồng hành[^:\n]*:\**\s*không\b/i.test(line)) out.push({ rule: 'invented', text: line.trim().slice(0, 80) })
    if (companions.length && /đồng hành[^:\n]*:\**\s*không\b/i.test(line)) out.push({ rule: 'none', text: line.trim().slice(0, 80) })
    return out
}

/** The companion names a persona states: its bold "**Name — Title:**" lines, the way modelSettings' persona text writes them. */
export function personaCompanions(persona) {
    return [...String(persona ?? '').matchAll(/\*\*([^*\n—-]{2,40}?)\s*[—-]\s*[^*\n]{2,60}:\*\*/g)].map((m) => m[1].trim()).filter((n) => /^[A-ZÀ-Ỹ]/.test(n))
}
