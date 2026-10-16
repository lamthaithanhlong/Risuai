import { describe, expect, it } from 'vitest'
import { adoptHandAssets, drawNewPortraits, keyOf, newLooks, parseLooks, portraitNote, portraitPrompt, referencesFor, stateOf, STALE_MS, stripLooks, withLooks, type CardLike, type PortraitDeps } from './portraits'

const REPLY = 'Một cô gái bước ra.\n[[LOOK Elise | silver hair to the shoulders, grey eyes, black hooded cloak, about twenty]]\nCô nhìn Kenji.\n[[LOOK Kenji Park | short black hair, tired brown eyes, torn school uniform, seventeen]]'

describe('the LOOK lines', () => {
    it('are read one per name, and never shown', () => {
        expect(parseLooks(REPLY).map((l) => l.name)).toEqual(['Elise', 'Kenji Park'])
        expect(parseLooks(REPLY + '\n[[LOOK elise | other]]')).toHaveLength(2)          // the first look wins
        expect(stripLooks(REPLY)).toBe('Một cô gái bước ra.\nCô nhìn Kenji.\n')
        expect(stripLooks('Cô bước ra.\n[[LOOK Eli')).toBe('Cô bước ra.\n')               // still streaming
    })
    it('the note names the player and what is drawn already', () => {
        const note = portraitNote({ elise: { name: 'Elise', look: 'x', status: 'done', at: 0 } }, 'Kenji Park')
        expect(note).toContain('(Kenji Park)')
        expect(note).toContain('met earlier in the story too')                         // a long chat's NPCs get theirs too
        expect(note).toContain('[[LOOK <name> |')
        expect(note).toContain('Already described, never again: Elise.')
        expect(portraitPrompt({ name: 'Elise', look: 'grey eyes' })).toContain('Elise: grey eyes')
    })
})

describe('who needs a portrait', () => {
    it('a new name, a failed one, or one lost while drawn; not one drawn or being drawn', () => {
        const now = 1_000_000
        const state = {
            done: { name: 'Done', look: '', status: 'done' as const, at: 0 },
            busy: { name: 'Busy', look: '', status: 'pending' as const, at: now - 1000 },
            lost: { name: 'Lost', look: '', status: 'pending' as const, at: now - STALE_MS - 1 },
            bad: { name: 'Bad', look: '', status: 'error' as const, at: now },
        }
        const looks = ['Done', 'Busy', 'Lost', 'Bad', 'New'].map((name) => ({ name, look: 'l' }))
        expect(newLooks(state, looks, now).map((l) => l.name)).toEqual(['Lost', 'Bad', 'New'])
    })
})

describe('references for a scene picture', () => {
    const state = {
        'kenji park': { name: 'Kenji Park', look: 'black hair', status: 'done' as const, at: 0, asset: 'assets/k.webp' },
        elise: { name: 'Elise', look: 'silver hair', status: 'done' as const, at: 0, asset: 'assets/e.webp' },
        sunny: { name: 'Sunny', look: 'pale', status: 'pending' as const, at: 0 },
    }
    it('the characters named in the prompt first, then in the message; the first name is enough; not one still drawn', () => {
        expect(referencesFor(state, 'Kenji climbs the roof', 'Elise holds his hand').map((e) => e.name)).toEqual(['Kenji Park', 'Elise'])
        expect(referencesFor(state, 'Elise on the roof, Kenji below').map((e) => e.name)).toEqual(['Kenji Park', 'Elise'])
        expect(referencesFor(state, 'Sunny and the elisean gate')).toEqual([])             // a word that only starts with Elise is not her
        expect(referencesFor(state, 'Kenji and Elise', '', 1)).toHaveLength(1)
    })
    it('the prompt is told who is in which image, with their look', () => {
        const p = withLooks('rain on the roof', referencesFor(state, 'Kenji and Elise'))
        expect(p).toContain('Kenji Park is the person in image1 (black hair)')
        expect(p).toContain('Elise is the person in image2 (silver hair)')
        expect(withLooks('rain', [])).toBe('rain')
    })
})

describe('drawing the portraits', () => {
    const deps = (over: Partial<PortraitDeps> = {}): PortraitDeps & { drawn: string[] } => {
        const drawn: string[] = []
        return {
            drawn, now: () => 1000,
            draw: async (prompt) => { drawn.push(prompt); return { inlayId: 'in-' + drawn.length } },
            keep: async (pic) => ({ path: `assets/${pic.inlayId}.webp`, ext: 'webp' }),
            ...over,
        }
    }
    it('each new character is drawn once and kept as an Additional Asset with their name', async () => {
        const card: CardLike = {}
        const d = deps()
        expect(await drawNewPortraits(card, REPLY, d)).toEqual(['Elise', 'Kenji Park'])
        expect(card.additionalAssets).toEqual([['Elise', 'assets/in-1.webp', 'webp'], ['Kenji Park', 'assets/in-2.webp', 'webp']])
        expect(stateOf(card)[keyOf('Elise')].status).toBe('done')
        expect(await drawNewPortraits(card, REPLY, d)).toEqual([])                        // the next reply: nothing again
        expect(d.drawn).toHaveLength(2)
    })
    it('a second reply while one is drawn does not draw it again', async () => {
        const card: CardLike = {}
        let release!: () => void
        const slow = deps({ draw: async () => { await new Promise<void>((r) => { release = r }); return { inlayId: 'x' } } })
        const first = drawNewPortraits(card, '[[LOOK Elise | a]]', slow)
        await Promise.resolve()
        expect(await drawNewPortraits(card, '[[LOOK Elise | a]]', slow)).toEqual([])
        release()
        await first
        expect(card.additionalAssets).toHaveLength(1)
    })
    it('a picture the learner added by hand is never replaced, and counts as drawn', async () => {
        const card: CardLike = { additionalAssets: [['Elise', 'assets/mine.png', 'png']] }
        await drawNewPortraits(card, '[[LOOK Elise | a]]', deps())
        expect(card.additionalAssets).toEqual([['Elise', 'assets/mine.png', 'png']])
        expect(stateOf(card).elise.asset).toBe('assets/mine.png')
        const card2: CardLike = { additionalAssets: [['Sunny', 'assets/s.png', 'png']], extentions: { vjPortraits: { sunny: { name: 'Sunny', look: 'pale', status: 'error', at: 0 } } } }
        adoptHandAssets(card2)
        expect(stateOf(card2).sunny).toMatchObject({ status: 'done', asset: 'assets/s.png' })
    })
    it('a failed picture is marked, and asked again at the next description', async () => {
        const card: CardLike = {}
        await drawNewPortraits(card, '[[LOOK Elise | a]]', deps({ draw: async () => ({ error: 'every model failed' }) }))
        expect(stateOf(card).elise).toMatchObject({ status: 'error', error: 'every model failed' })
        expect(await drawNewPortraits(card, '[[LOOK Elise | a]]', deps())).toEqual(['Elise'])
    })
})

describe('the picture type of a reference', async () => {
    const { mimeOf } = await import('./portraits')
    it('is read from the bytes', () => {
        expect(mimeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
        expect(mimeOf(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
        expect(mimeOf(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    })
})

describe('the player\'s own character (reported: Kenji Park has a persona picture; drawing him again gave someone else)', async () => {
    const { withPlayer, playerLook, portraitNote, drawNewPortraits, referencesFor } = await import('./portraits')
    const kenji = { name: 'Kenji Park', icon: 'assets/b087.png', prompt: '[{{user}} = Kenji Park, nam, 25 tuổi, đeo kính, nhân viên văn phòng]' }
    it('the persona picture is the portrait and its description the look', () => {
        expect(playerLook(kenji)).toBe('Kenji Park = Kenji Park, nam, 25 tuổi, đeo kính, nhân viên văn phòng')
        const st = withPlayer({}, kenji)
        expect(st['kenji park']).toMatchObject({ status: 'done', asset: 'assets/b087.png' })
        expect(referencesFor(st, 'Kenji climbs the roof').map((e) => e.asset)).toEqual(['assets/b087.png'])
        expect(withPlayer({}, { name: 'Kenji Park' })).toEqual({})               // no picture: drawn like anyone else
    })
    it('the story is not asked to describe him, and he is not drawn again', async () => {
        expect(portraitNote(withPlayer({}, kenji), kenji.name)).toContain('Already described, never again: Kenji Park')
        const card = {}
        const drawn: string[] = []
        await drawNewPortraits(card, '[[LOOK Kenji Park | seventeen, school uniform]]\n[[LOOK Elise | grey eyes]]', {
            now: () => 1, draw: async (p) => { drawn.push(p); return { inlayId: 'x' } }, keep: async () => ({ path: 'assets/x.webp', ext: 'webp' }),
        }, () => {}, kenji)
        expect(drawn).toHaveLength(1)
        expect(drawn[0]).toContain('Elise')
    })
})

// asked 2026-10-15: "cái tự generate profile character cũng cho mọi chat luôn"
describe('every chat: copies of the same story share portraits', async () => {
    const { adoptFromSiblings, stateOf, withLooksText, drawNewPortraits } = await import('./portraits')
    it('a copy takes what the other drew, and does not draw it again', async () => {
        const a = { additionalAssets: [['Elise', 'assets/e.webp', 'webp']] as [string, string, string][], extentions: { vjPortraits: { elise: { name: 'Elise', look: 'grey eyes', status: 'done', at: 1, asset: 'assets/e.webp' } } } }
        const b: any = {}
        adoptFromSiblings(b, [a, b])
        expect(b.additionalAssets).toEqual([['Elise', 'assets/e.webp', 'webp']])
        expect(stateOf(b).elise.status).toBe('done')
        const drawn: string[] = []
        await drawNewPortraits(b, '[[LOOK Elise | grey eyes]]', { now: () => 2, draw: async (p) => { drawn.push(p); return { inlayId: 'x' } }, keep: async () => ({ path: 'p', ext: 'webp' }) })
        expect(drawn).toEqual([])
    })
    it('one not finished, or a name already kept, is not taken', () => {
        const a = { extentions: { vjPortraits: { sunny: { name: 'Sunny', look: '', status: 'pending', at: 1 } } } }
        const b: any = { additionalAssets: [['Elise', 'assets/mine.png', 'png']], extentions: { vjPortraits: { elise: { name: 'Elise', look: '', status: 'done', at: 1, asset: 'assets/mine.png' } } } }
        adoptFromSiblings(b, [a, { extentions: { vjPortraits: { elise: { name: 'Elise', look: '', status: 'done', at: 1, asset: 'assets/other.png' } } } }])
        expect(b.additionalAssets).toEqual([['Elise', 'assets/mine.png', 'png']])
        expect(stateOf(b).sunny).toBeUndefined()
    })
    it('a provider without reference images still gets the looks in words', () => {
        const refs = [{ name: 'Kenji Park', look: '25, glasses', status: 'done' as const, at: 0, asset: 'a' }]
        expect(withLooksText('rain', refs)).toBe('rain\n\nCharacters: Kenji Park: 25, glasses.')
        expect(withLooksText('rain', [])).toBe('rain')
    })
})
