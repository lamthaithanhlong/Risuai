import { beforeEach, describe, expect, it, vi } from 'vitest'

const db: any = {}
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))

import { learningDisplay, learningKeepsOriginal, learningRequest, noteLearningVocab, VOCAB_VAR } from './learning'

const userOf = (out: any[]) => out.find((m) => m.role === 'user' || m.role === 'assistant').content

beforeEach(() => {
    for (const k of Object.keys(db)) delete db[k]
    Object.assign(db, { learningMode: true, learningReadings: true, learningTyping: true, learningLang: 'ja' })
})

const req = (content: string, role = 'user') => [{ role, content }] as any

describe('learning mode off', () => {
    it('changes nothing anywhere', () => {
        db.learningMode = false
        expect(learningDisplay('「やめて」')).toBe('「やめて」')
        expect(learningRequest(req('da me te'))).toEqual(req('da me te'))
        expect(learningKeepsOriginal('やめて')).toBe(false)
        const chat: any = { message: [{ role: 'char', data: '「はい」 (Vâng)' }] }
        noteLearningVocab(chat)
        expect(chat.scriptstate).toBeUndefined()
    })
})

describe('learning mode on', () => {
    it('reads the replies box once: one reading per word, not two', () => {
        const out = learningDisplay('「はい」 (Vâng)\n\n[[REPLIES\nはい | Vâng\n]]')
        expect(out.match(/>ha-i<\/span>/g)?.length).toBe(2)          // once in the body, once in the box
        expect(out).toContain('Bạn có thể đáp')
        expect(out).not.toContain('[[REPLIES')
    })
    it('shows readings, and not when readings are switched off', () => {
        expect(learningDisplay('「やめて」')).toContain('>da-mê-tê</span>')
        db.learningReadings = false
        expect(learningDisplay('「やめて」')).toBe('「やめて」')
    })
    it('sends Việt-ji typing as kana, with or without a name prefix, and leaves Vietnamese and the model turns alone', () => {
        expect(userOf(learningRequest(req('da me te')))).toBe('やめて')
        expect(userOf(learningRequest(req('Kenji: oa ca ri ma xi ta')))).toBe('Kenji: わかりました')
        expect(userOf(learningRequest(req('Tôi đi ra chợ.')))).toBe('Tôi đi ra chợ.')
        expect(userOf(learningRequest(req('da me te', 'assistant')))).toBe('da me te')
        db.learningTyping = false
        expect(userOf(learningRequest(req('da me te')))).toBe('da me te')
    })
    it('adds the format note for the chosen language right before the last user message', () => {
        const out = learningRequest([{ role: 'system', content: 'story' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] as any)
        expect(out.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user'])
        expect(out[3].content).toContain('LEARNING FORMAT')
        expect(out[3].content).toContain('今日[きょう]')
        db.learningLang = 'zh'
        expect(learningRequest(req('x')).find((m: any) => m.role === 'system').content).toContain('pinyin')
        db.learningLang = 'ko'
        expect(learningRequest(req('an nhong')).find((m: any) => m.role === 'user').content).toBe('an nhong')   // no kana typing outside Japanese
        db.learningLang = 'es'
        expect(learningRequest(req('x')).find((m: any) => m.role === 'system').content).toContain('«»')
        db.learningLang = 'fr'
        const fr = learningRequest(req('x')).find((m: any) => m.role === 'system').content
        expect(fr).toContain('French')
        expect(fr).toContain('« Bonjour, ça coûte combien ? »')
    })
    it('keeps Japanese messages out of auto-translate', () => {
        expect(learningKeepsOriginal('Ông nói 「はい」')).toBe(true)
        expect(learningKeepsOriginal('Ông nói vâng')).toBe(false)
    })
    it('adds what the speaker said to the chat vocabulary after a reply', () => {
        const chat: any = { message: [{ role: 'user', data: 'x' }, { role: 'char', data: '「しお です。」 (Đây là muối.)' }] }
        noteLearningVocab(chat)
        expect(JSON.parse(chat.scriptstate[VOCAB_VAR])[0]).toMatchObject({ text: 'しお です。', vietji: 'xi-ô đê-sư' })
    })
})
