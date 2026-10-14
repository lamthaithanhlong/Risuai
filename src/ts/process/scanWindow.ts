// The last `depth` items of `items`, or all of them when there are fewer.
//
// `items.slice(items.length - depth)` looks the same but is wrong when depth > length: the start becomes negative and slice
// counts it from the end, so 4 messages with a scan depth of 5 return only the last message, and 8 with a depth of 12 return 4.
// For the lorebook that meant keys in the first messages of a short chat were not seen.
export function lastItems<T>(items: readonly T[], depth: number): T[] {
    if (!(depth > 0)) {
        return []
    }
    return items.slice(Math.max(0, items.length - depth))
}
