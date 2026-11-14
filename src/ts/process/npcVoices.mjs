// On-stage NPCs speak from their own short request (asked 2026-11-08: the story stays, Aki or Naru is not one narrator
// writing both). The narrator leaves [[SAY|id]]; each marker is one voice, and the next voice hears the lines already filled.
// Ollama 9B often ignores the marker and writes the lines itself (New Chat 2, 2026-11-08, empty $led_npc): then we fall back to
// portrait names on stage and rewrite attributed quotes with the same voice bots.
import { blankNpc, cardLine, EVENTS_ID, foldNpc, scrubRegister } from './npcCheck.mjs'

const slug = (s) => String(s ?? '').normalize('NFC').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)
const esc = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SAY = /\[\[\s*SAY\s*\|([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/iu
const SPEECH = '(?:nói|hỏi|đáp|gọi|hét|thì thầm|lẩm bẩm|thốt|kêu|bảo|gắt|trả lời|lên tiếng)'

/** Thin cards from display names when the ledger is still empty (first turns, New Chat). */
export function cardsFromNames(names, n = 999) {
    const out = []
    const seen = new Set()
    for (const raw of names ?? []) {
        const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
        const id = slug(name)
        if (!name || !id || seen.has(id)) continue
        seen.add(id)
        const c = blankNpc(id, name)
        c.lastTurn = n
        out.push(c)
        if (out.length >= 3) break
    }
    return out
}

/** Portrait / cast names that appear as whole words in recent text. */
export function namesNamedIn(text, names) {
    const t = ` ${String(text ?? '').toLowerCase()} `
    const out = []
    const seen = new Set()
    for (const raw of names ?? []) {
        const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
        if (!name) continue
        const full = name.toLowerCase()
        const first = full.split(/\s+/)[0]
        const has = (w) => w.length >= 2 && new RegExp(`[^\\p{L}]${esc(w)}[^\\p{L}]`, 'u').test(t)
        if (!(has(full) || (first !== full && has(first)))) continue
        const k = slug(name)
        if (seen.has(k)) continue
        seen.add(k)
        out.push(name)
        if (out.length >= 3) break
    }
    return out
}

/** True when `name` has an attributed spoken line in `text` (Name…nói…“…” or “…” — Name). */
export function hasAttributedSpeech(text, name) {
    const n = String(name ?? '').replace(/\s+/g, ' ').trim()
    if (!n) return false
    const names = [...new Set([n, n.split(/\s+/)[0]])].filter((w) => w.length >= 2).map(esc).join('|')
    if (!names) return false
    const out = String(text ?? '')
    const post = new RegExp(`("([^"\\n]+)"|“([^”\\n]+)”)(\\s*[—-]\\s*(?:${names})(?![\\p{L}\\p{N}]))`, 'iu')
    if (post.test(out)) return true
    const pre = new RegExp(`(?:${names})[^“”"\\n]{0,48}${SPEECH}[^“”"\\n]{0,20}:?\\s*("([^"\\n]+)"|“([^”\\n]+)”)`, 'iu')
    return pre.test(out)
}

/** Portrait names that both appear and speak in this reply (not merely mentioned / in assets). */
export function speakingNamesIn(text, names) {
    return namesNamedIn(text, names).filter((n) => hasAttributedSpeech(text, n)).slice(0, 3)
}

/** NPCs with a card in the last 3 replies, newest first, at most 3. Empty ledger → `extras` names (portraits on stage). */
export function onstageNpcs(ledger, n, extras = []) {
    const fromLed = [...foldNpc(ledger, n).values()]
        .filter((c) => !c.isAdmin && c.id !== EVENTS_ID && c.lastTurn >= n - 3)
        .sort((a, b) => b.lastTurn - a.lastTurn)
        .slice(0, 3)
    if (fromLed.length) return fromLed
    return cardsFromNames(extras, n)
}

/** One or two sentences from a voice reply. A quoted span wins; otherwise the raw text, name-prefix stripped. */
export function takeOneQuote(raw) {
    const t = String(raw ?? '').trim()
    if (!t) return ''
    const q = /“([^”]+)”|"([^"]+)"/u.exec(t)
    let line = (q ? (q[1] ?? q[2]) : t).replace(/\s+/g, ' ').trim()
    line = line.replace(/^(?:[^\s:“”"]{1,40}\s+)?(?:nói|hỏi|đáp|bảo)\s*:\s*/iu, '')
    const sents = line.split(/(?<=[.!?…])\s+/u).map((s) => s.trim()).filter(Boolean).slice(0, 2)
    return sents.join(' ').replace(/^["“]|["”]$/g, '').trim()
}

const oneLine = (s, max) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max).trimEnd() + '…' : t }

/**
 * What was said in the last turns, for one voice: the player's messages and this person's own spoken lines, oldest first.
 * `messages` are the chat messages before the reply being written; the player's newest message (`playerText`) is left out, the prompt carries it apart.
 */
export function recentTalk(messages, name, playerText = '') {
    const list = [...(messages ?? [])]
    const now = oneLine(playerText, 9999)
    if (now && list.length && list[list.length - 1]?.role === 'user' && oneLine(list[list.length - 1].data, 9999) === now) list.pop()
    const n = String(name ?? '').replace(/\s+/g, ' ').trim()
    const names = [...new Set([n, n.split(/\s+/)[0]])].filter((w) => w.length >= 2).map(esc).join('|')
    const said = names ? new RegExp(`(?:${names})[^“”"\\n]{0,48}${SPEECH}[^“”"\\n]{0,20}:?\\s*(?:"([^"\\n]+)"|“([^”\\n]+)”)`, 'giu') : null
    const out = []
    for (const m of list.slice(-8)) {
        const data = String(m?.data ?? '')
        if (m?.role === 'user') { const t = oneLine(data, 200); if (t) out.push(`Người chơi: “${t}”`) }
        else if (said) for (const q of data.matchAll(said)) out.push(`${n}: “${oneLine(q[1] ?? q[2], 240)}”`)
    }
    return out.slice(-8).join('\n')
}

/**
 * The prompt for one voice. `scene` is the reply so far, up to this marker, with earlier voices already filled. `talk` = { player, recent }: the
 * player's message this turn and recentTalk(); without them she answered a scene, not a person (asked back her own old question, asked again for a
 * form already handed in: trường nghề chat, 2026-11-13).
 */
export function npcVoicePrompt(card, scene, talk = {}) {
    const seen = String(scene ?? '').trim().slice(-1800)
    const player = oneLine(talk?.player, 400)
    const recent = String(talk?.recent ?? '').trim()
    return [
        `Bạn chỉ đóng ${card.name} trong truyện đang chạy. In đúng một hoặc hai câu thoại, nằm trong ngoặc kép “…” . Không kể cảnh, không đóng ai khác, không viết lời người chơi.`,
        `Thẻ của bạn: ${cardLine(card)}`,
        recent ? `Mấy lượt vừa qua (đã nói rồi, đừng nói lại, đừng hỏi lại, đừng đòi lại thứ đã nhận hay việc đã xong):\n${recent}` : '',
        `Cảnh tới lúc bạn nói. Lời của người khác trong lượt này đã nằm trong cảnh; hãy đáp lại họ:`,
        seen || '(chưa có cảnh)',
        player ? `Người chơi vừa nói: “${player}”\nNếu đó là một câu hỏi hay một thắc mắc với bạn, hãy trả lời thẳng điều được hỏi bằng điều bạn biết trước; chỉ hỏi lại khi thật sự thiếu một điều để trả lời, và không hỏi câu bạn đã hỏi ở trên.` : '',
        `Viết lời của ${card.name}.`,
    ].filter(Boolean).join('\n\n')
}

function cardFor(cards, rawId) {
    const id = slug(rawId)
    const raw = String(rawId ?? '').trim().toLowerCase()
    return cards.find((c) => c.id === id || slug(c.name) === id || c.name.toLowerCase() === raw)
}

async function speak(card, scene, ask, talk) {
    try {
        const line = takeOneQuote(await ask(npcVoicePrompt(card, scene, talk ? { player: talk.player, recent: recentTalk(talk.history, card.name, talk.player) } : {})))
        // a person the ledger has no name for (name = id, "chi-phu-trach") gets no label: the narration around the marker says who speaks
        const label = card.name && card.name !== card.id ? `${card.name} nói: ` : ''
        return line ? `${label}“${line}”\n` : ''
    } catch {
        return ''
    }
}

/**
 * Weak narrators (Ollama 9B) write attributed quotes instead of [[SAY|aki]]. Replace each attributed quote once,
 * in order of appearance, so the next voice hears the line just rewritten.
 */
export async function rewireOnstageQuotes(text, cards, ask, talk) {
    if (!cards?.length || !ask) return String(text ?? '')
    let out = String(text ?? '')
    // Only rewrite people who already have an attributed quote in this draft (skip cast that is merely named).
    const speaking = cards.filter((c) => hasAttributedSpeech(out, c.name))
    if (!speaking.length) return out
    const order = [...speaking].sort((a, b) => {
        const ia = out.toLowerCase().indexOf(a.name.toLowerCase())
        const ib = out.toLowerCase().indexOf(b.name.toLowerCase())
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib)
    })
    for (const card of order) {
        const names = [...new Set([card.name, card.name.split(/\s+/)[0]])].map(esc).join('|')
        // Paired quotes only ("…" or “…”). Do not let a closer be reused as an opener across lines.
        const postQuote = new RegExp(
            `("([^"\\n]+)"|“([^”\\n]+)”)(\\s*[—-]\\s*(?:${names})(?![\\p{L}\\p{N}]))`,
            'iu',
        )
        const post = postQuote.exec(out)
        if (post) {
            const scene = out.slice(0, post.index)
            const spoken = await speak(card, scene, ask, talk)
            if (spoken) {
                const inner = takeOneQuote(spoken)
                const open = post[0][0]
                const close = open === '“' ? '”' : '"'
                out = out.slice(0, post.index) + open + inner + close + post[4] + out.slice(post.index + post[0].length)
            }
            continue
        }
        const re = new RegExp(
            `((?:${names})[^“”"\\n]{0,48}${SPEECH}[^“”"\\n]{0,20}:?\\s*)("([^"\\n]+)"|“([^”\\n]+)”)`,
            'iu',
        )
        const m = re.exec(out)
        if (!m) continue
        const scene = out.slice(0, m.index)
        const spoken = await speak(card, scene, ask, talk)
        if (!spoken) continue
        // Keep the narrator's lead-in/attribution and only swap the quoted words.
        const inner = takeOneQuote(spoken)
        const q = m[2]
        const open = q[0]
        const close = open === '“' ? '”' : '"'
        out = out.slice(0, m.index) + m[1] + open + inner + close + out.slice(m.index + m[0].length)
    }
    return out
}

/**
 * Replace each [[SAY|id]] in order. When the narrator skipped the markers but named people still speak,
 * rewrite their attributed quotes (Ollama path). `extras` seeds the cast when $led_npc is empty.
 */
export async function fillNpcVoices(text, ledger, n, ask, extras = [], playerText = '', history = []) {
    const talk = { player: playerText, history }
    const cards = onstageNpcs(ledger, n, extras)
    let out = String(text ?? '')
    out = out.replace(/^[ \t]*\[\[?\s*SAY\s*\|[^\]\n]+\]\]?[ \t]*\n+(?=[ \t]*["“])/gimu, '')
    let filledSay = false
    if (SAY.test(out)) {
        let guard = 0
        while (guard++ < 6) {
            const m = /\[\[\s*SAY\s*\|([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/iu.exec(out)
            if (!m) break
            filledSay = true
            const card = cardFor(cards, m[1])
            const scene = out.slice(0, m.index).replace(/\[\[\s*SAY\s*\|[^\]\n]*\]\]/giu, '').trim()
            const spoken = card && ask ? await speak(card, scene, ask, talk) : ''
            out = out.slice(0, m.index) + spoken + out.slice(m.index + m[0].length)
        }
        out = out.replace(/\[\[\s*SAY\s*\|[^\]\n]*\]\]/giu, '')
    }
    if (!filledSay && cards.length && ask) {
        out = await rewireOnstageQuotes(out, cards, ask, talk)
    }
    const eligible = cards.every((c) => c.lastTurn === n && c.self === 'tôi' && c.toPlayer === 'anh')
    return scrubRegister(out.replace(/\n{3,}/g, '\n\n'), cards, eligible ? playerText : '')
}
