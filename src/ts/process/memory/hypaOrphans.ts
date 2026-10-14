// Dropping orphaned HypaV3 summaries (specs/core/MemoryChain.tla).
//
// The summaries form a chain, and the context is built from startIdx = the position after the LAST message of the LAST summary:
// everything before it is assumed to be covered by the summaries. Dropping a summary from the middle of the chain (because one of
// its messages was deleted) leaves its other messages in neither the context nor a summary: TLC found it in 9 steps.
// Only orphaned summaries at the END of the chain are dropped. startIdx then falls back to before them, so their surviving messages
// are raw again and get summarized again. An orphaned summary in the middle is kept: stale, but nothing is lost.

export function trimOrphanedTail<S extends { chatMemos: Set<string> }>(summaries: S[], presentMemos: Set<string>): S[] {
    let end = summaries.length
    while (end > 0 && !isSubset(summaries[end - 1].chatMemos, presentMemos)) {
        end--
    }
    return end === summaries.length ? summaries : summaries.slice(0, end)
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
    for (const elem of subset) {
        if (!superset.has(elem)) {
            return false
        }
    }
    return true
}
