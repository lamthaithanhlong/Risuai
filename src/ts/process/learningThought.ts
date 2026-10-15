// What the learner meant, in Vietnamese, while putting a sentence together word by word in the bar (asked: think in Vietnamese,
// pick the words, be corrected after sending). Reported 2026-10-15: "hết sức bình sinh tui leo lên được" became
// 매우 병 태어나다 나 빨리 위 이기다 (bình → 병, sinh → 태어나다), and the check, seeing only the Korean, read 병 as "sick" and
// taught 아파요. The Vietnamese typed for each chip is kept here and goes with the message, so the check corrects toward it.

// kept in this browser too: a reload lost them, and the "Chi tiết" of an older message then guessed what was meant
// (그렇게 개 거기 이다 개 이상하다뭐 그렇다 was read as "lạ đến vậy", meant "thế cái đó là cái quái gì vậy")
const KEY = 'risu-vj-thoughts'
const MAX = 200
const recent: { text: string; viet: string }[] = (() => {
    try { const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.slice(-MAX) : [] } catch { return [] }
})()
const save = () => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(recent)) } catch { /* private window: this session only */ } }

export function rememberThought(text: string, viet: string) {
    const t = text.trim()
    if (!t || !viet.trim()) return
    recent.push({ text: t, viet: viet.trim() })
    if (recent.length > MAX) recent.shift()
    save()
}

/** The Vietnamese behind a sent message: the newest sentence built in the bar that the message is, or starts with. */
export function thoughtFor(message: string): string | null {
    const m = (message ?? '').trim()
    if (!m) return null
    for (let i = recent.length - 1; i >= 0; i--) if (m === recent[i].text || m.startsWith(recent[i].text)) return recent[i].viet
    return null
}

export function thoughtNote(viet: string): string {
    return `\n(What the player meant, in Vietnamese, picking the words one by one: «${viet}». Their words are a word-by-word try at this; `
        + 'the [[CHECK]] corrects toward this meaning, a whole Vietnamese phrase can be one expression in the language.)'
}

export function forgetThoughts() { recent.length = 0; save() }
