// The story guide's behaviour, decided in code (2026-11-03): the card's prompt rules ("hints only on request or after two turns
// without progress, never repeat a sentence, scout ~10 m") were not followed 5 times of 5, so the GM decides them here and the
// narrator only gets one short directive line. Nothing of this is shown to the player.

import { sentencesOf } from './replyCheck.mjs'

type Msg = { role: string; data: string; chatId?: string }

/** The guide's name from the card's lore: the built lore entry is titled "Story guide: <Name>". */
export function guideNameOf(card: { globalLore?: { comment?: string }[] } | undefined): string {
    for (const l of card?.globalLore ?? []) {
        const m = /^\s*Story guide\s*:\s*(.+?)\s*$/i.exec(l?.comment ?? '')
        if (m) return m[1]
    }
    return ''
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// small on purpose: a hint or a look-around the player asks for, in Vietnamese
const ASK = /(gợi ý|nhắc (tớ|tôi|mình|giúp)|nhìn thử|nhìn xem|xem giúp|xem hộ|xem thử|kiểm tra (ngoài|giúp|xem|bên|phía)|có gì không|có ai không|đi xem|ra xem|qua xem|dò xét|thám thính)/i

/** True when the player asks for a hint or asks the guide to look somewhere ("gợi ý", "nhìn thử", "xem giúp", "có gì không", name + imperative). */
export function playerAsks(text: string, name = ''): boolean {
    const t = (text ?? '').normalize('NFC')
    if (ASK.test(t)) return true
    if (name) {
        // name + imperative: "Hana, xem phòng bên", "Hana ơi nhìn…", "Hana đi kiểm tra"
        const imp = '(xem|nhìn|ngó|kiểm tra|dò|thử|đi|ra|qua|nghe|bay)'
        return new RegExp(`(^|[\\s,.!?"“])${esc(name)}\\s*(ơi|à|nhé)?\\s*[,:]?\\s*${imp}(\\s|$|[,.!?])`, 'iu').test(t)
    }
    return false
}

/** The guide's spoken sentences (text between “ ”) in the last n narrator replies that mention her. Oldest first. */
export function guideRecentLines(messages: Msg[], name: string, n = 3): string[] {
    if (!name) return []
    const replies = messages.filter((m) => m.role === 'char' && (m.data ?? '').includes(name)).slice(-n)
    const out: string[] = []
    for (const r of replies) {
        for (const q of r.data.matchAll(/“([^”]+)”/g)) {
            // a quote sentence by sentence, so one repeated sentence is caught inside a longer line
            for (const s of q[1].split(/(?<=[.!?…])\s+/)) {
                const t = s.trim()
                if (t.length >= 4) out.push(t)
            }
        }
    }
    return out
}

// ---- what she already told ---------------------------------------------------------------------------------------------------
// Measured 2026-11-03: "Do not restate" held only the last 3 replies' sentences word for word; the scout then said the same
// observation again in other words ("người mặc đồ ngủ đứng sát cửa đối diện" -> "... cửa căn bên cạnh", "không thấy gì khác trong
// hành lang" -> "... trong đoạn đó"). So the app keeps a list of clauses (all her earlier speech) and compares by token overlap.

const FILLER = new Set(['tớ', 'cậu', 'mình', 'tui', 'ừ', 'ừm', 'à', 'ạ', 'ơi', 'nhé', 'nha', 'nè', 'hả', 'này', 'đó', 'kia', 'ấy', 'thì', 'là', 'và', 'mà', 'có', 'một', 'những', 'các', 'cái', 'của', 'ở', 'với', 'rồi', 'đang', 'đã', 'sẽ', 'quá', 'lắm', 'thật', 'cũng', 'vẫn', 'còn', 'hình', 'như', 'chắc', 'thôi', 'đây', 'nó', 'ta', 'bạn', 'anh', 'em', 'chị'])

const tokensOf = (s: string): string[] => (s.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !FILLER.has(w))

/** A clause worth remembering: at least 3 content words once fillers and pronouns are dropped (an exclamation or "Tớ sợ." is not a detail). */
const concrete = (clause: string): boolean => tokensOf(clause).length >= 3

const clausesOf = (speech: string): string[] =>
    speech.split(/[.!?…;,\n]+/).map((c) => c.trim()).filter((c) => c.length > 0)

const overlap = (a: string[], b: string[]): number => {
    if (!a.length || !b.length) return 0
    const sb = new Set(b)
    let n = 0
    for (const w of new Set(a)) if (sb.has(w)) n++
    return n / Math.min(new Set(a).size, sb.size)
}

/** Whether a line says again something already told: some concrete clause of it shares >= 60% of its content words with a told item. */
export function restates(line: string, told: string[]): boolean {
    const toks = told.map(tokensOf)
    for (const c of clausesOf(line ?? '')) {
        if (!concrete(c)) continue
        const t = tokensOf(c)
        if (toks.some((o) => o.length >= 3 && overlap(t, o) >= 0.6)) return true
    }
    return false
}

/** The concrete details of the guide's earlier speech (quotes of replies that name her), newest first, without repeats, at most max. */
export function alreadyTold(messages: Msg[], name: string, max = 12): string[] {
    if (!name) return []
    const out: string[] = []
    const replies = messages.filter((m) => m.role === 'char' && (m.data ?? '').includes(name))
    for (let i = replies.length - 1; i >= 0 && out.length < max; i--) {
        const quotes = [...replies[i].data.matchAll(/“([^”]+)”/g)].map((q) => q[1])
        for (let j = quotes.length - 1; j >= 0 && out.length < max; j--) {
            const cl = clausesOf(quotes[j])
            for (let k = cl.length - 1; k >= 0 && out.length < max; k--) {
                if (!concrete(cl[k]) || restates(cl[k], out)) continue
                out.push(cl[k])
            }
        }
    }
    return out
}

/**
 * Sentences the narrator must not reuse word for word (measured 2026-11-03: the guide said "Cậu muốn tớ nhìn qua bên kia không?" twice,
 * and a scene line came back in the next reply). guide: her full quoted sentences; scene: non-quoted sentences of the last 3 replies.
 * Newest first, no duplicates. The same >= 5-word sentences replyCheck.mjs flags after generation.
 */
export function verbatimAvoid(messages: Msg[], name: string, maxGuide = 12, maxScene = 8): { guide: string[]; scene: string[] } {
    const guide: string[] = []
    const scene: string[] = []
    const replies = messages.filter((m) => m.role === 'char')
    for (const r of [...replies].reverse()) {
        if (name && (r.data ?? '').includes(name)) {
            for (const q of [...r.data.matchAll(/“([^”]+)”/g)].reverse()) {
                for (const s of [...sentencesOf(q[1])].reverse()) if (guide.length < maxGuide && !guide.includes(s)) guide.push(s)
            }
        }
    }
    for (const r of [...replies].slice(-3).reverse()) {
        for (const s of [...sentencesOf((r.data ?? '').replace(/“[^”]*”/g, '\n'))].reverse()) if (scene.length < maxScene && !scene.includes(s)) scene.push(s)
    }
    return { guide, scene }
}

export type GuideInput = {
    present: boolean
    name: string
    playerText: string
    /** replies since the story last advanced (sinceAdvance) */
    turnsWithoutProgress: number
    recentLines: string[]
    asked: boolean
    /** alreadyTold(): concrete details she already said, in any words */
    told?: string[]
    /** verbatimAvoid(): sentences not to reuse word for word */
    avoid?: string[]
}

/** One to three short English lines for the narrator; '' when the guide is not in the story. */
export function guideDirective(i: GuideInput): string {
    if (!i.present || !i.name) return ''
    const out: string[] = []
    const mayHint = i.asked || i.turnsWithoutProgress >= 2
    out.push(mayHint
        ? `${i.name} may hint: as a question or one concrete detail, never the answer.`
        : `${i.name}: no hint this turn.`)
    if (i.asked) out.push(`If asked to look: ${i.name} reports one concrete detail within ~10 m; beyond that she knows nothing and says so.`)
    if (i.recentLines.length) out.push(`Do not restate: ${i.recentLines.map((l) => `"${l}"`).join(' ')}`)
    if (i.told?.length) out.push(`đã kể rồi, không nhắc lại: ${i.told.join('; ')}`)
    if (i.avoid?.length) out.push(`do not reuse these sentences verbatim: ${i.avoid.map((l) => `"${l}"`).join(' ')}`)
    out.push('a 【ADMIN…】 or 【HỆ THỐNG…】 line may repeat only when a value changed.')
    return out.join(' ')
}

/** The whole guide note for this turn, or '' (no guide named in the card's lore). */
export function guideNote(card: { globalLore?: { comment?: string }[] } | undefined, messages: Msg[], player: string, turnsWithoutProgress: number): string {
    const name = guideNameOf(card)
    if (!name) return ''
    const v = verbatimAvoid(messages, name)
    const d = guideDirective({ avoid: [...v.guide, ...v.scene], present: true, name, playerText: player, turnsWithoutProgress,
        recentLines: guideRecentLines(messages, name), told: alreadyTold(messages, name), asked: playerAsks(player, name) })
    return d ? `\n[Guide (hidden, never named): ${d}]` : ''
}
