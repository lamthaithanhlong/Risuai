/**
 * The blocks the story writes for the bar and the portraits ([[REPLIES]], [[CHECK]], [[LOOK]]) are not translated: the
 * auto-translation turned 네, 가요. | Vâng, đi thôi. into Vâng, đi thôi. | Vâng, đi thôi., and the bar could no longer read it
 * (reported 2026-10-15). Each is swapped for a token the model keeps, and put back after; one the model dropped goes at the end.
 */
export function keepMachineBlocks(text: string): { text: string; restore: (translated: string) => string } {
    const kept: string[] = []
    const guarded = (text ?? '').replace(/\[\[(?:REPLIES|CHECK|LOOK)\b[\s\S]*?\]\]/g, (b) => `[[KEEP-${kept.push(b) - 1}]]`)
    return {
        text: guarded,
        restore: (translated: string) => {
            let out = translated ?? ''
            kept.forEach((b, i) => {
                const token = `[[KEEP-${i}]]`
                out = out.includes(token) ? out.replace(token, () => b) : `${out.trimEnd()}\n${b}`
            })
            return out
        },
    }
}
