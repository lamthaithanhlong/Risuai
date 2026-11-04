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
    // repeated facts are what the owner flagged (her second answer repeating the first): quoted speech at 60%, any other sentence only
    // when it is the same sentence (90%): a scene line such as "Ngoài cửa, hành lang vẫn im." recurs honestly between two replies
    const speech = (r) => sentences([...r.matchAll(/“([^”]+)”/g)].map((m) => m[1]).join('\n'))
    for (let i = 1; i < rs.length; i++) {
        const hit = speech(rs[i]).find((s) => speech(rs[i - 1]).some((p) => overlap(p, s) >= 0.6)) ?? sentences(rs[i]).find((s) => sentences(rs[i - 1]).some((p) => overlap(p, s) >= 0.9))
        if (hit) out.push({ rule: 'repeat', reply: i, text: hit.slice(0, 100) })
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

const ABSENT = /không có ai (hiện|đáp|trả lời|lên tiếng)|chẳng (có )?ai (đáp|trả lời|hiện)|không ai (đáp|trả lời)|tên (cô|nó|ấy) (tan|chìm|tắt|rơi) (vào|trong)|không (có )?(hình bóng|tiếng) (nào )?(đáp|trả lời)/i

/**
 * The three cases of the companion rule (owner 2026-11-03, "gõ tên là hiện"):
 *   persona names her                         -> the record names her
 *   persona names none, the player did not call -> the record says "Không"
 *   persona names none, the player called her   -> she appears in the reply to the call: named, speaking, not "no one answers"
 * `record` is the creation record, `reply` the narrator's reply to the call (only when summoned).
 */
export function companionCaseProblems({ companions, record, summoned = false, reply = '', name = 'Evelyn' }) {
    const out = companionProblems(record, companions)
    if (summoned) {
        const r = String(reply ?? '')
        if (!r.toLowerCase().includes(name.toLowerCase())) out.push({ rule: 'not-named', text: `${name} is not in the reply to her call` })
        else if (!/[“"]/.test(r)) out.push(ABSENT.test(r) ? { rule: 'absent', text: (ABSENT.exec(r) ?? [''])[0] } : { rule: 'silent', text: `${name} appears but does not speak` })
    }
    return out
}

/** REPORT-ONLY (L1, 2026-11-03): a non-speech sentence (>= 6 tokens) of a reply that the previous reply already had at 60% or more. */
export function sceneRepeats(replies) {
    const rs = replies.map((r) => String(r ?? ''))
    const out = []
    for (let i = 1; i < rs.length; i++) {
        const prev = sentences(rs[i - 1].replace(/“[^”]*”/g, ' '))
        for (const s of sentences(rs[i].replace(/“[^”]*”/g, ' '))) if (prev.some((p) => overlap(p, s) >= 0.6)) out.push({ reply: i, text: s.slice(0, 100) })
    }
    return out
}

// ---- the story guide (owner 2026-11-03, Zombie): scouting inside ~10 m, no spoilers, no System text -----------------------------------

/** Her spoken lines: quoted speech in her register (tớ / cậu). */
export const herSpeech = (reply) => [...String(reply ?? '').matchAll(/“([^”]+)”/g)].map((m) => m[1]).filter((s) => /(?<!\p{L})(tớ|cậu)(?!\p{L})/iu.test(s))

const SYSTEM_WORDS = /mức nhiễm|HỆ THỐNG|nhận dạng mẫu|KHÁCH-\d+|\d+\s?%/i
const FUTURE = /(?<!\p{L})(sắp|sẽ|rồi sẽ|lát nữa|ngày mai|tuần sau|sau này)(?!\p{L})[^.?!…]{0,40}(?<!\p{L})(chết|tấn công|bùng phát|sập|nổ|xảy ra|kéo đến|tràn vào|đến đây|đến cửa)(?!\p{L})/iu
const FAR = /tận\s+(tầng|B\d|dưới cùng|mái|sảnh)|\bB\d\b|tầng hầm/i

/** noSpoiler: she states no future event, no System text, nothing beyond ~10 m (a remembered place asked as a question is fine). */
export function guideNoSpoilerProblems(speech) {
    const out = []
    for (const line of speech) {
        for (const sent of String(line).split(/(?<=[.!?…])\s+/)) {
            if (SYSTEM_WORDS.test(sent)) out.push({ rule: 'system-text', text: sent.slice(0, 90) })
            if (FUTURE.test(sent)) out.push({ rule: 'future', text: sent.slice(0, 90) })
            const m = /(\d+)\s?(m|mét)\b/.exec(sent)
            if (m && Number(m[1]) > 10) out.push({ rule: 'range', text: sent.slice(0, 90) })
            const fl = /tầng\s+(\d+)/i.exec(sent)
            if (fl && Math.abs(Number(fl[1]) - 7) > 3 && !/[?？]\s*$/.test(sent)) out.push({ rule: 'range', text: sent.slice(0, 90) })
            if (FAR.test(sent) && !(/(?<!\p{L})nhớ(?!\p{L})/iu.test(sent) && /[?？]\s*$/.test(sent))) out.push({ rule: 'range', text: sent.slice(0, 90) })
        }
    }
    return out
}

const CONCRETE = /\d|(bên|phía)\s+(trái|phải|trên|dưới|kia)|cuối hành lang|cầu thang|căn\s*\d+|cửa|màu|tiếng|áo|đứng|nằm|quay/i
const WORRY = /sợ|lo|đừng|nhé\s?\?|hình như|không chắc|cẩn thận|chắc vậy/i
/** scout: asked to check the corridor, she reports one concrete detail and a worry, inside her range. */
export function guideScoutProblems(reply) {
    const speech = herSpeech(reply)
    if (!speech.length) return [{ rule: 'no-report', text: 'she does not speak' }]
    const all = speech.join(' ')
    const out = []
    if (!CONCRETE.test(all)) out.push({ rule: 'vague', text: all.slice(0, 90) })
    if (!WORRY.test(all)) out.push({ rule: 'no-worry', text: all.slice(0, 90) })
    return [...out, ...guideNoSpoilerProblems(speech)]
}
