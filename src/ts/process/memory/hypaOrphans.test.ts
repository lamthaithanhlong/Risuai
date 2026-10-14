import { describe, expect, it } from 'vitest'
import { trimOrphanedTail } from './hypaOrphans'

type Sum = { chatMemos: Set<string> }
const sum = (...m: string[]): Sum => ({ chatMemos: new Set(m) })
const present = (...m: string[]) => new Set(m)

describe('trimOrphanedTail (specs/core/MemoryChain.tla)', () => {
    it('keeps a chain whose messages are all present', () => {
        const s = [sum('a', 'b'), sum('c')]
        expect(trimOrphanedTail(s, present('a', 'b', 'c', 'd'))).toBe(s)
    })

    it('drops an orphaned summary at the end', () => {
        const s = [sum('a', 'b'), sum('c', 'd')]
        expect(trimOrphanedTail(s, present('a', 'b', 'd'))).toEqual([s[0]])
    })

    it('drops every orphaned summary at the end, not only the last', () => {
        const s = [sum('a'), sum('b'), sum('c')]
        expect(trimOrphanedTail(s, present('a'))).toEqual([s[0]])
    })

    it('keeps an orphaned summary in the middle, so nothing before the last summary is left uncovered', () => {
        const s = [sum('a', 'b'), sum('c', 'd')]
        // message a was deleted: the first summary is orphaned but is followed by a healthy one
        expect(trimOrphanedTail(s, present('b', 'c', 'd'))).toBe(s)
    })

    // The context skips every message up to the last message of the last summary (hypav3.ts startIdx). A message is lost when it
    // is skipped and no kept summary covers it. Replay random chats the way the model does and check nothing is lost.
    it('property: no message still in the chat is lost from the context', () => {
        let state = 4242
        const rnd = (n: number) => Math.floor(((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n)
        for (let trial = 0; trial < 300; trial++) {
            let chat: string[] = []
            let sums: Sum[] = []
            let next = 1
            for (let step = 0; step < 40; step++) {
                const op = rnd(4)
                if (op === 0) chat.push('m' + next++)
                else if (op === 1 && chat.length) chat.splice(rnd(chat.length), 1)
                else if (op === 2) sums = trimOrphanedTail(sums, new Set(chat))          // the generate step cleans first...
                else {                                                                    // ...then summarizes after startIdx
                    const startIdx = startIndex(chat, sums)
                    if (chat.length - startIdx >= 2) {
                        const end = startIdx + 1 + rnd(chat.length - 1 - startIdx)       // keeps the newest message raw
                        sums.push({ chatMemos: new Set(chat.slice(startIdx, end)) })
                    }
                }
                const startIdx = startIndex(chat, sums)
                const covered = new Set<string>()
                for (const s of sums) for (const m of s.chatMemos) covered.add(m)
                for (let i = 0; i < chat.length; i++) {
                    const raw = i >= startIdx
                    expect(raw || covered.has(chat[i])).toBe(true)
                }
            }
        }
    })
})

// the position after the last message of the last summary, 0 when there is none or it is gone (hypav3.ts lines ~1019-1031)
function startIndex(chat: string[], sums: Sum[]): number {
    if (!sums.length) return 0
    const last = [...sums[sums.length - 1].chatMemos].at(-1)!
    const idx = chat.indexOf(last)
    return idx === -1 ? 0 : idx + 1
}
