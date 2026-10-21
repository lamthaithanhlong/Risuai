import fc from 'fast-check'
import { flushSync } from 'svelte'
import { expect, test } from 'vitest'
import { readDeep, watchSaveChanges, type SaveChange } from './saveWatch.svelte'

function makeDb() {
    const card = (id: string) => ({
        chaId: id, name: id, desc: 'card ' + id, chatPage: 0,
        globalLore: [{ key: 'k', content: 'lore '.repeat(50) }],
        chats: [
            { id: id + '-c0', message: [{ role: 'user', data: 'hi' }], scriptstate: {}, isStreaming: false },
            { id: id + '-c1', message: [], scriptstate: {}, isStreaming: false },
        ],
    })
    return {
        theme: 'dark', personas: [{ name: 'p' }], botPresetsId: 0, botPresets: [{ name: 'b' }],
        modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characters: [card('a'), card('b')],
    }
}

/** the effects on a $state database; `runs` counts the effect runs by kind since the last take() */
function watch() {
    const s = $state({ db: makeDb(), sel: 0 })
    let runs: SaveChange[] = []
    const stop = $effect.root(() => { watchSaveChanges(() => s.db, () => s.sel, (c) => runs.push(c)) })
    flushSync()
    const take = () => { const r = runs; runs = []; return r }
    take()
    const kinds = (r: SaveChange[]) => r.map((c) => c.kind).sort()
    return { s, take, kinds, stop }
}

test('readDeep visits every array and plain object, skips typed arrays, and ends on a cycle', () => {
    expect(readDeep({ a: [1, { b: 2 }], c: { d: [] } })).toBe(5)
    expect(readDeep({ big: new Uint8Array(1_000_000) })).toBe(1)
    const x: any = { y: {} }
    x.y.back = x
    expect(readDeep(x)).toBe(2)
    expect(readDeep(null)).toBe(0)
})

test('a message re-runs only the chats effect, a card edit only the character effect, a setting only the root', () => {
    const w = watch()
    w.s.db.characters[0].chats[0].message.push({ role: 'char', data: 'reply' })
    flushSync()
    expect(w.take()).toEqual([{ kind: 'character', chaId: 'a', chatId: 'a-c0' }])

    w.s.db.characters[0].globalLore[0].content = 'changed'
    flushSync()
    expect(w.take()).toEqual([{ kind: 'character', chaId: 'a', chatId: 'a-c0' }])

    w.s.db.theme = 'light'
    flushSync()
    expect(w.kinds(w.take())).toEqual(['root'])

    w.s.db.botPresets.push({ name: 'c' })
    w.s.db.modules.push({ id: 'm' } as never)
    flushSync()
    expect(w.kinds(w.take())).toEqual(['botPreset', 'modules'])
    w.stop()
})

test('the character effect does not walk the chats: a message costs no walk of the card', () => {
    const w = watch()
    // three message edits: three runs, all of the chats effect (the card effect would report the same change twice per edit)
    for (let i = 0; i < 3; i++) { w.s.db.characters[0].chats[0].message[0].data = 'edit ' + i; flushSync() }
    expect(w.take().length).toBe(3)
    w.stop()
})

test('while a reply streams only the flag is watched; the end of the stream re-runs it', () => {
    const w = watch()
    const chat = w.s.db.characters[0].chats[0]
    chat.isStreaming = true
    flushSync()
    w.take()
    for (let i = 0; i < 20; i++) { chat.message[0].data = 'chunk ' + i; flushSync() }
    expect(w.take()).toEqual([])
    chat.isStreaming = false
    flushSync()
    expect(w.take()).toEqual([{ kind: 'character', chaId: 'a', chatId: 'a-c0' }])
    w.stop()
})

test('another chat of the selected character still counts (a reply can land in a chat that is not open)', () => {
    const w = watch()
    w.s.db.characters[0].chats[1].message.push({ role: 'char', data: 'late reply' })
    flushSync()
    expect(w.take()).toEqual([{ kind: 'character', chaId: 'a', chatId: 'a-c0' }])
    w.stop()
})

test('selecting another character or chat reports it', () => {
    const w = watch()
    w.s.sel = 1
    flushSync()
    expect(w.take().every((c) => c.kind === 'character' && c.chaId === 'b')).toBe(true)
    w.s.db.characters[1].chatPage = 1
    flushSync()
    expect(w.take().some((c) => c.kind === 'character' && c.chatId === 'b-c1')).toBe(true)
    w.stop()
})

// No lost change: whatever is edited, at least one effect reports it, and it names the part the encoder must re-encode.
test('property: every edit is reported with the right kind', () => {
    const edits = [
        (d: any, v: string) => { d.theme = v; return 'root' },
        (d: any, v: string) => { d.personas[0].name = v; return 'root' },
        (d: any, v: string) => { d.characters[0].desc = v; return 'character' },
        (d: any, v: string) => { d.characters[0].globalLore.push({ key: v, content: v }); return 'character' },
        (d: any, v: string) => { d.characters[0].chats[0].message.push({ role: 'user', data: v }); return 'character' },
        (d: any, v: string) => { d.characters[0].chats[1].scriptstate['$' + v] = v; return 'character' },
        (d: any, v: string) => { d.characters[0].chats[0].message[0].data = v; return 'character' },
        (d: any, v: string) => { d.botPresets.push({ name: v }); return 'botPreset' },
        (d: any, v: string) => { d.pluginCustomStorage[v] = v; return 'pluginCustomStorage' },
    ]
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: edits.length - 1 }), fc.string({ minLength: 1, maxLength: 6 })), { minLength: 1, maxLength: 12 }), (seq) => {
        const w = watch()
        try {
            // the step number makes every value new: the same short string twice was no edit at all (an assignment of the value already
            // there fires nothing), and the property failed ~7% of runs (seed 2052363108: [[1,"x"],[1,"x"],[0," "]])
            for (const [step, [i, v]] of seq.entries()) {
                const want = edits[i](w.s.db, `x${v}#${step}`)
                flushSync()
                const got = w.take()
                if (!got.some((c) => c.kind === want && (c.kind !== 'character' || c.chaId === 'a'))) return false
            }
            return true
        } finally { w.stop() }
    }), { numRuns: 200 })
})
