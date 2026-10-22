// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { browserDraftStorage, createDraftBook, draftKey, inputBoxHeight, readDraft, writeDraft, DRAFT_PREFIX, type DraftStorage } from './chatDraft'
import { createDictation, type DictationDeps } from './dictation'

function memory(): DraftStorage & { map: Map<string, string> } {
    const map = new Map<string, string>()
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v) }, removeItem: (k) => { map.delete(k) } }
}
const broken: DraftStorage = {
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('QuotaExceededError') },
    removeItem: () => { throw new Error('SecurityError') },
}

describe('draftKey', () => {
    it('is one key per (character, chat), with the character in it: chat ids repeat across characters', () => {
        expect(draftKey('c1', 'x')).not.toBe(draftKey('c2', 'x'))
        expect(draftKey('c1', 'x')).toBe(DRAFT_PREFIX + 'c1:x')
    })
    it('does not let a ":" inside an id make two chats one key', () => {
        expect(draftKey('a:b', 'c')).not.toBe(draftKey('a', 'b:c'))
    })
    it('is no key without a character or a chat id', () => {
        expect(draftKey('', 'x')).toBeNull()
        expect(draftKey('c1', undefined)).toBeNull()
    })
    it('an id encodeURIComponent cannot encode (a lone surrogate) gets no key instead of throwing', () => {
        expect(draftKey('c1', 'x\uD800')).toBeNull()
    })
})

describe('storage that throws', () => {
    it('loses the drafts, never the input', () => {
        expect(readDraft(broken, 'k')).toBe('')
        expect(() => writeDraft(broken, 'k', 'x')).not.toThrow()
        const book = createDraftBook(broken)
        expect(book.open('a', '')).toBe('')
        expect(book.deliver('a', 'xin chào', '')).toBe('xin chào')
        expect(() => book.open('b', 'xin chào')).not.toThrow()
    })
    it('reading localStorage itself may throw', () => {
        const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
        try { expect(browserDraftStorage()).toBeNull() } finally {
            if (desc) Object.defineProperty(globalThis, 'localStorage', desc)
            else delete (globalThis as any).localStorage
        }
    })
})

describe('the box belongs to the open chat', () => {
    const A = draftKey('char', 'chatA')!, B = draftKey('char', 'chatB')!

    it('switching chats does not carry the text over, and coming back brings it back', () => {
        const s = memory(), book = createDraftBook(s)
        let box = book.open(A, '')
        box = 'đang viết dở ở A'; book.update(box)
        box = book.open(B, box)
        expect(box).toBe('')
        box = book.open(A, box)
        expect(box).toBe('đang viết dở ở A')
    })

    it('a dictation that comes back after the switch lands in the chat it was spoken in, not the open one', async () => {
        const s = memory(), book = createDraftBook(s)
        let box = book.open(A, '')
        let release: (r: Response) => void = () => {}
        const deps: DictationDeps = {
            getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
            createRecorder: (_s, m) => ({
                state: 'inactive', mimeType: m, ondataavailable: null, onstop: null, onerror: null,
                start() { this.state = 'recording' },
                stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['a']) }); this.onstop?.() },
            }),
            isTypeSupported: () => true,
            fetch: async (url) => url.endsWith('/warm') ? new Response('{}') : new Promise<Response>((r) => { release = r }),
            auth: async () => 'token',
            setInterval: () => 1,
            clearInterval: () => {},
        }
        // the screen's wiring (DefaultChatScreen.svelte MicButton): tag = the open chat, onText = drafts.deliver
        const d = createDictation(deps, (text, said) => { box = book.deliver(said === undefined ? book.owner : said as string, text, box) }, () => {}, 120, () => book.owner)
        d.toggle(); await new Promise((r) => setTimeout(r, 0))
        d.toggle(); await new Promise((r) => setTimeout(r, 0))   // mic off: transcribing
        box = book.open(B, box)                                    // the player opens chat B while the Mac transcribes
        release(new Response(JSON.stringify({ text: 'tôi mở cửa' })))
        await new Promise((r) => setTimeout(r, 10))
        expect(box).toBe('')                                        // B's box stays empty
        expect(readDraft(s, A)).toBe('tôi mở cửa')                  // A got its words
        expect(book.open(A, box)).toBe('tôi mở cửa')
    })

    it('words for the open chat go into the box and are stored with it', () => {
        const s = memory(), book = createDraftBook(s)
        let box = book.open(A, '')
        box = book.deliver(A, 'một', box)
        box = book.deliver(A, 'hai', box)
        expect(box).toBe('một hai')
        expect(readDraft(s, A)).toBe('một hai')
    })

    it('a failed send goes back to its chat, unless that chat has new words; never into another chat', () => {
        const s = memory(), book = createDraftBook(s)
        let box = book.open(A, '')
        box = book.open(B, '')                         // A's send left the box empty, then B opened
        box = book.putBack(A, 'lời gửi hỏng', box)
        expect(box).toBe('')
        expect(readDraft(s, A)).toBe('lời gửi hỏng')
        box = book.open(A, box)
        box = book.putBack(A, 'cũ', 'mới gõ')
        expect(box).toBe('mới gõ')
    })

    it('a sent draft is gone; a screen that closes keeps the box under its chat and later words go to storage', () => {
        const s = memory(), book = createDraftBook(s)
        let box = book.open(A, '')
        box = 'gửi đi'; book.update(box)
        book.clear(A)
        expect(readDraft(s, A)).toBe('')
        box = 'chưa gửi'; book.update(box)
        book.close(box)
        expect(book.deliver(A, 'nói thêm', '')).toBe('')
        expect(readDraft(s, A)).toBe('chưa gửi nói thêm')
    })
})

describe('inputBoxHeight', () => {
    it('grows with the text up to 40% of the screen, then scrolls inside', () => {
        expect(inputBoxHeight(44, 812)).toEqual({ height: 44, scrolls: false })
        expect(inputBoxHeight(3376, 812)).toEqual({ height: 324, scrolls: true })
        expect(inputBoxHeight(3376, 900).height).toBe(360)
    })
    it('never caps below two lines, even on a tiny or unknown viewport', () => {
        expect(inputBoxHeight(500, 100).height).toBe(88)
        expect(inputBoxHeight(500, 0).height).toBe(320)
    })
})

describe('a send takes only what it sent', () => {
    it('keeps words typed or dictated during the send\'s awaits, and a box edited meanwhile', async () => {
        const { afterSend } = await import('./chatDraft')
        expect(afterSend('gửi đi', 'gửi đi')).toBe('')
        expect(afterSend('gửi đi nói thêm', 'gửi đi')).toBe('nói thêm')
        expect(afterSend('đã sửa', 'gửi đi')).toBe('đã sửa')
        expect(afterSend('bản nháp', '')).toBe('bản nháp')
    })
    it('out of the box when its chat is open, else out of that chat\'s stored draft', () => {
        const s = memory(), book = createDraftBook(s)
        const A = draftKey('char', 'chatA')!, B = draftKey('char', 'chatB')!
        let box = book.open(A, '')
        box = 'gửi đi nói thêm'; book.update(box)
        expect(book.took(A, 'gửi đi', box)).toBe('nói thêm')
        box = book.open(B, 'nói thêm')
        expect(book.took(A, 'nói', box)).toBe('')
        expect(readDraft(s, A)).toBe('thêm')
    })
})

describe('a screen made again', () => {
    it('gets a dictation that was still being transcribed when the old screen went away', () => {
        const s = memory(), book = createDraftBook(s)
        const A = draftKey('char', 'chatA')!
        // old screen: chat A open, a dictation tagged A in flight; the screen goes away
        book.open(A, '')
        book.close('viết dở')
        // new screen on the same page: same book, chat A again, listening
        const shown: string[] = []
        const stop = book.listen((t) => shown.push(t))
        let box = book.open(A, '')
        expect(box).toBe('viết dở')
        // the old screen's mic callback fires now: no current text of its own, the book's box is used
        book.deliver(A, 'nói thêm')
        expect(shown).toEqual(['viết dở nói thêm'])
        expect(readDraft(s, A)).toBe('viết dở nói thêm')
        stop()
        book.deliver(A, 'nữa')
        expect(shown).toHaveLength(1)
    })
})
