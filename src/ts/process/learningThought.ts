// What the learner meant, in Vietnamese, while putting a sentence together word by word in the bar (asked: think in Vietnamese,
// pick the words, be corrected after sending). Reported 2026-10-15: "hết sức bình sinh tui leo lên được" became
// 매우 병 태어나다 나 빨리 위 이기다 (bình → 병, sinh → 태어나다), and the check, seeing only the Korean, read 병 as "sick" and
// taught 아파요. The Vietnamese typed for each chip is kept here and goes with the message, so the check corrects toward it.

const recent: { text: string; viet: string }[] = []

export function rememberThought(text: string, viet: string) {
    const t = text.trim()
    if (!t || !viet.trim()) return
    recent.push({ text: t, viet: viet.trim() })
    if (recent.length > 20) recent.shift()
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

export function forgetThoughts() { recent.length = 0 }
