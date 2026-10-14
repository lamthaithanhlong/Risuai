// The numbers HypaV3 does arithmetic and loops with, made safe (specs/core/SummarizeLoop.dfy, MemoryBudget.dfy).
//
// The settings page limits them (maxChatsPerSummary min 1, queryChatCount 1 to 20), but nothing checks a preset that was imported
// or saved by another version, and typeof NaN is "number". Dafny: the summarization loop ends only with maxChatsPerSummary >= 1; with
// 0, a negative number or NaN a round drops no chat and the loop spins forever, freezing the page. A NaN ratio makes every
// "fits in the reservation" test false, so every summary is selected and the prompt overflows. queryChatCount 0 makes
// chats.slice(-0), which is ALL chats, the similarity query.

export interface HypaNumericSettings {
    maxChatsPerSummary: number
    queryChatCount: number
    memoryTokensRatio: number
    extraSummarizationRatio: number
    recentMemoryRatio: number
    similarMemoryRatio: number
}

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function sanitizeHypaV3Settings<T extends HypaNumericSettings>(s: T): T {
    return {
        ...s,
        maxChatsPerSummary: Math.max(1, Math.floor(finite(s.maxChatsPerSummary, 6))),
        queryChatCount: Math.max(1, Math.floor(finite(s.queryChatCount, 3))),
        memoryTokensRatio: clamp01(finite(s.memoryTokensRatio, 0.2)),
        extraSummarizationRatio: clamp01(finite(s.extraSummarizationRatio, 0)),
        recentMemoryRatio: clamp01(finite(s.recentMemoryRatio, 0.4)),
        similarMemoryRatio: clamp01(finite(s.similarMemoryRatio, 0.4)),
    }
}
