// The story guide's behaviour, decided in code (2026-11-03): the card's prompt rules ("hints only on request or after two turns
// without progress, never repeat a sentence, scout ~10 m") were not followed 5 times of 5, so the GM decides them here and the
// narrator only gets one short directive line. Nothing of this is shown to the player.

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

export type GuideInput = {
    present: boolean
    name: string
    playerText: string
    /** replies since the story last advanced (sinceAdvance) */
    turnsWithoutProgress: number
    recentLines: string[]
    asked: boolean
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
    return out.join(' ')
}

/** The whole guide note for this turn, or '' (no guide named in the card's lore). */
export function guideNote(card: { globalLore?: { comment?: string }[] } | undefined, messages: Msg[], player: string, turnsWithoutProgress: number): string {
    const name = guideNameOf(card)
    if (!name) return ''
    const d = guideDirective({ present: true, name, playerText: player, turnsWithoutProgress,
        recentLines: guideRecentLines(messages, name), asked: playerAsks(player, name) })
    return d ? `\n[Guide (hidden, never named): ${d}]` : ''
}
