// Which part of the database changed, for the autosave. Svelte re-runs an effect when anything it read changes, so each part is
// read in its own effect, by walking it (readDeep) instead of copying it.
//
// It used to be one effect that took $state.snapshot of every root setting, of the whole selected character (card, lorebook,
// scripts: 0.6-1.4 MB on the owner's story cards) and of all its chats. Any change anywhere (a message pushed, a translation, a
// script variable) re-ran it and deep-copied all of that through the state proxies: 7.1 s of main thread over three played turns
// with 4x CPU throttling on a copy of the owner's save, in long tasks up to 0.7 s (tests/acceptance/jank.mjs). The copies were only
// there to subscribe; what gets saved is read from the database itself (RisuSaveEncoder.set). Now a message only re-walks the
// chats, and the card is walked again only when the card changes.

import { shouldTrackChatContent } from './saveTracker'

/**
 * Reads every value under `value` (arrays and plain objects; a typed array or class instance is a leaf), so an effect that calls
 * it depends on all of it, without allocating a copy. Returns how many containers it visited. A cycle is visited once.
 */
export function readDeep(value: unknown): number {
    const stack: unknown[] = [value]
    const seen = new Set<object>()
    let n = 0
    while (stack.length > 0) {
        const v = stack.pop()
        if (v === null || typeof v !== 'object' || seen.has(v)) continue
        seen.add(v)
        if (Array.isArray(v)) {
            n++
            for (let i = 0; i < v.length; i++) stack.push(v[i])
            continue
        }
        const proto = Object.getPrototypeOf(v)
        if (proto !== Object.prototype && proto !== null) continue
        n++
        for (const k in v) stack.push((v as Record<string, unknown>)[k])
    }
    return n
}

/** What one effect run says changed. Root settings are encoded on every save, so they need no name. */
export type SaveChange =
    | { kind: 'root' }
    | { kind: 'botPreset' } | { kind: 'modules' } | { kind: 'loadouts' } | { kind: 'plugins' } | { kind: 'pluginCustomStorage' }
    | { kind: 'character', chaId: string, chatId: string | undefined }

// the root keys with blocks of their own (RisuSaveEncoder), and the characters
const OWN_BLOCK = new Set(['characters', 'botPresets', 'modules', 'loadouts', 'plugins', 'pluginCustomStorage'])

type WatchedDb = Record<string, any> & { characters?: any[] }

/**
 * Starts the effects; call inside an effect root (or a component). `db` and `selected` are read inside the effects, so a new
 * database object or another selected character re-runs the ones that depend on them.
 */
export function watchSaveChanges(db: () => WatchedDb | undefined, selected: () => number, onChange: (c: SaveChange) => void): void {
    $effect(() => {
        const d = db()
        d?.botPresetsId
        d?.botPresets?.length
        onChange({ kind: 'botPreset' })
    })
    for (const kind of ['modules', 'loadouts', 'plugins', 'pluginCustomStorage'] as const) {
        $effect(() => {
            readDeep(db()?.[kind])
            onChange({ kind })
        })
    }
    $effect(() => {
        const d = db()
        if (d) for (const key in d) if (!OWN_BLOCK.has(key)) readDeep(d[key])
        onChange({ kind: 'root' })
    })
    const current = () => {
        const char = db()?.characters?.[selected()]
        return char ? { char, chaId: char.chaId as string, chatId: char.chats?.[char.chatPage]?.id as string | undefined } : null
    }
    // the selected character without its chats: the card, lorebook, scripts, chat page
    $effect(() => {
        const c = current()
        if (!c) return
        for (const key in c.char) if (key !== 'chats') readDeep(c.char[key])
        onChange({ kind: 'character', chaId: c.chaId, chatId: c.chatId })
    })
    // its chats: all of them (a reply can land in a chat that is no longer open, chatSlot.ts), but only the flag while one streams
    $effect(() => {
        const c = current()
        if (!c) return
        const chats = c.char.chats
        if (Array.isArray(chats) && shouldTrackChatContent(chats[c.char.chatPage])) readDeep(chats)
        onChange({ kind: 'character', chaId: c.chaId, chatId: c.chatId })
    })
}
