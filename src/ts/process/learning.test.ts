import { beforeEach, describe, expect, it, vi } from 'vitest'

const db: any = {}
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))

import { readNotebook } from './learningStore'
import { SAY_BUTTON } from './vietji'
import { forgetThoughts, rememberThought } from './learningThought'
import { howToSayPrompt, learningReminder, CHECK_MISSED_LAST_VAR, CHECK_MISSED_VAR, GRADED_FOR_VAR, HISTORY_VAR, learningDisplay, learningKeepsOriginal, learningRequest, MISTAKES_VAR, noteLearningVocab, VOCAB_VAR } from './learning'

// the player's text as sent, without the format reminder learningRequest puts after the last one
const userOf = (out: any[]) => out.find((m) => m.role === 'user' || m.role === 'assistant').content.split('\n\n[Format for this reply')[0]

const nb = () => readNotebook(db, 'ja')

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
        expect(learningDisplay('「やめて」')).toBe('「やめて」 ' + SAY_BUTTON)          // no readings, but it can still be heard
    })
    it('sends Việt-ji typing as kana, with or without a name prefix, and leaves Vietnamese and the model turns alone', () => {
        expect(userOf(learningRequest(req('da me te')))).toBe('やめて')
        expect(userOf(learningRequest(req('Kenji: oa ca ri ma xi ta')))).toBe('Kenji: わかりました')
        expect(userOf(learningRequest(req('Tôi đi ra chợ.')))).toBe('Tôi đi ra chợ.')
        expect(userOf(learningRequest(req('da me te', 'assistant')))).toBe('da me te')
        expect(userOf(learningRequest(req('? cái muối này bao nhiêu')))).toBe('? cái muối này bao nhiêu')   // asking how to say it
        expect(userOf(learningRequest(req('Kenji: ? ca ra')))).toBe('Kenji: ? ca ra')
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
        expect(userOf(learningRequest(req('an nhong')))).toBe('an nhong')   // no kana typing outside Japanese
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
        expect(nb().vocab[0]).toMatchObject({ text: 'しお です。', vietji: 'xi-ô đê-sư' })
    })
    it('grades the learner’s line from the speaker’s check, keeps the mistake, counts right and wrong', () => {
        const chat: any = { message: [
            { role: 'char', data: '「いくら ですか」 (Bao nhiêu tiền?)' },
            { role: 'user', data: 'i cu ra dde su' },
            { role: 'char', data: 'Haru cười.\n[[CHECK いくら です → いくら ですか | thiếu か]]' },
        ] }
        noteLearningVocab({ ...chat, message: chat.message.slice(0, 1) })   // the first reply adds the phrase
        chat.scriptstate = { [VOCAB_VAR]: JSON.stringify([{ text: 'いくら ですか', vietji: 'i-cư-ra đê-sư-ca', meaning: 'Bao nhiêu tiền?' }]) }
        noteLearningVocab(chat, 1_800_000_000_000)
        expect(nb().mistakes[0]).toMatchObject({ wrong: 'いくら です', right: 'いくら ですか', count: 1 })
        expect(nb().history).toEqual([false])
    })
    it('shows a fix as one Sửa line and never the raw check block', () => {
        const out = learningDisplay('Haru cười.\n[[CHECK ok]]')
        expect(out).not.toContain('CHECK')
        const fix = learningDisplay('Haru cười.\n[[CHECK はい → はい、ください | thiếu ください]]')
        expect(fix).toContain('Sửa:')
        expect(fix).not.toContain('[[CHECK')
    })
    it('the reminder goes after the last player message only, in the request only', () => {
        db.learningLang = 'zh'
        const input = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: '我 有 问题' }] as any
        const out = learningRequest(input)
        const users = out.filter((m: any) => m.role === 'user')
        expect(users[0].content).toBe('a')
        expect(users[1].content).toBe('我 有 问题' + learningReminder('zh', true))     // words first is on by default
        expect(learningReminder('zh')).toContain('Chinese')
        expect(learningReminder('zh')).toContain('pinyin')                 // 快开门！ came back without brackets
        expect(learningReminder('ja')).toContain('hiragana')
        expect(input[2].content).toBe('我 有 问题')                      // what is stored is never changed
    })
    it('a story without a foreign speaker still teaches: one line in the language and the answers in EVERY reply', () => {
        const note = learningRequest(req('x')).find((m: any) => m.role === 'system').content
        expect(note).toMatch(/EVERY reply[^\n]*one short line/)
        expect(note).toMatch(/EVERY reply, without exception, ends with four to six/)
    })
    it('the note asks for four to six answers of three kinds, and explains "?"', () => {
        const note = learningRequest(req('x')).find((m: any) => m.role === 'system').content
        expect(note).toContain('four to six')
        expect(note).toContain('workaround')
        expect(note).toContain('"?"')
    })
    it('the how-to-say request asks for three kinds in the REPLIES format, in the language\'s own writing', () => {
        const p = howToSayPrompt('có', 'fr', ['Merci'])
        expect(p).toContain('"có"')
        expect(p).toContain('French')
        expect(p).toContain('[[REPLIES')
        expect(p).toMatch(/easy[\s\S]*stretch[\s\S]*workaround/)
        expect(p).toContain('Merci')
        expect(howToSayPrompt('nước', 'ja')).toContain('hiragana')
    })
    it('a grammar check counts the words right, saves the point, and is not a mistake', () => {
        const chat: any = { message: [{ role: 'user', data: '我 想 她 有点 傻' }, { role: 'char', data: 'Haru cười.\n[[CHECK grammar 我 想 她 有点 傻 → 我觉得她有点傻 | "nghĩ là" dùng 觉得]]' }], scriptstate: {} }
        noteLearningVocab(chat, 1_800_000_000_000)
        expect(nb().history).toEqual([true])
        expect(nb().mistakes).toEqual([])
        expect(nb().grammar?.[0]).toMatchObject({ point: '"nghĩ là" dùng 觉得', right: '我觉得她有点傻' })
    })
    it('a "? ..." line is a question, not a try: it is not graded', () => {
        const chat: any = { message: [{ role: 'user', data: '? ca ra' }, { role: 'char', data: 'Haru cười.\n[[CHECK ca ra → から | sai]]' }], scriptstate: {} }
        noteLearningVocab(chat, 1_800_000_000_000)
        expect(nb().history).toEqual([])
        expect(nb().mistakes).toEqual([])
    })
    it('the request note carries the phrases due for review', () => {
        const chat: any = { scriptstate: { [VOCAB_VAR]: JSON.stringify([{ text: 'はい', vietji: 'ha-i', meaning: 'Vâng', due: 1 }]) } }
        const out = learningRequest(req('x'), chat, 1_800_000_000_000)
        expect(out.find((m: any) => m.role === 'system').content).toContain('はい (Vâng)')
    })
    it('still grades with rows saved in the old format (kana instead of text)', () => {
        const chat: any = {
            message: [{ role: 'user', data: 'phu ta tsu dde su ca' }, { role: 'char', data: 'Haru gật đầu.\n[[CHECK ok]]' }],
            scriptstate: { [VOCAB_VAR]: JSON.stringify([
                { kana: 'ふたつ ですか。', vietji: 'phư-ta-tsư đê-sư-ca', meaning: 'Hai đồng à?' },
                { text: 'はい', vietji: 'ha-i', meaning: 'Vâng' },
                'junk', { text: 'no reading' },
            ]) },
        }
        noteLearningVocab(chat, 1_800_000_000_000)
        const vocab = nb().vocab
        expect(vocab.map((v: any) => v.text)).toEqual(['ふたつ ですか。', 'はい'])
        expect(vocab[0].reps).toBe(1)
        expect((vocab[0] as Record<string, unknown>).kana).toBeUndefined()
        expect(nb().history).toEqual([true])
    })
    describe('when the speaker forgets the check', () => {
        const known = JSON.stringify([{ text: 'いいえ、いりません。', vietji: 'i-i-ê i-ri-ma-sên', meaning: 'Không, tôi không lấy.' }])
        const turn = (user: string, reply = 'Haru gật đầu.'): any => ({ message: [{ role: 'user', data: user }, { role: 'char', data: reply }], scriptstate: { [VOCAB_VAR]: known } })
        it('a line that is exactly a known phrase is graded right, and the miss is counted and logged', () => {
            const chat = turn('i i ê, i ri ma sên')
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(nb().vocab[0].reps).toBe(1)
            expect(nb().history).toEqual([true])
            expect(chat.scriptstate[CHECK_MISSED_VAR]).toBe('1')
            expect(chat.scriptstate[CHECK_MISSED_LAST_VAR]).toBe('1')
        })
        it('a line Risu cannot judge is not graded at all, only counted', () => {
            const chat = turn('ha i ma ta')
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(nb().vocab[0].reps).toBeUndefined()
            expect(nb().history).toEqual([])
            expect(chat.scriptstate[CHECK_MISSED_VAR]).toBe('1')
        })
        it('a Vietnamese line is not a missed check', () => {
            const chat = turn('Tôi đi chợ.')
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(chat.scriptstate[CHECK_MISSED_VAR]).toBeUndefined()
            expect(chat.scriptstate[CHECK_MISSED_LAST_VAR]).toBe('0')
        })
        it('the next request reminds the speaker; a reply with its check clears the reminder', () => {
            const chat = turn('ha i ma ta')
            noteLearningVocab(chat, 1_800_000_000_000)
            const note = () => learningRequest(req('x'), chat).find((m: any) => m.role === 'system').content
            expect(note()).toContain('forgot the [[CHECK]] line')
            chat.message.push({ role: 'user', data: 'ha i' }, { role: 'char', data: 'ok\n[[CHECK ok]]' })
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(note()).not.toContain('forgot the [[CHECK]] line')
        })
    })
    it('old-format rows reach the notebook in the clean form even when the reply adds nothing', () => {
        const chat: any = { message: [{ role: 'char', data: 'Haru im lặng.' }], scriptstate: { [VOCAB_VAR]: JSON.stringify([{ kana: 'はい', vietji: 'ha-i', meaning: 'Vâng' }]) } }
        noteLearningVocab(chat)
        expect(nb().vocab).toEqual([{ vietji: 'ha-i', meaning: 'Vâng', text: 'はい' }])
    })
    describe('found by the TLA+ model (Grading.tla)', () => {
        const known = JSON.stringify([{ text: 'いいえ、いりません。', vietji: 'i-i-ê i-ri-ma-sên', meaning: 'Không, tôi không lấy.' }])
        it('a rerolled reply does not grade the same learner line twice', () => {
            const chat: any = { message: [{ role: 'user', data: 'i i ê, i ri ma sên', chatId: 'u1' }, { role: 'char', data: 'a\n[[CHECK ok]]' }], scriptstate: { [VOCAB_VAR]: known } }
            noteLearningVocab(chat, 1_800_000_000_000)
            chat.message[1] = { role: 'char', data: 'b (rerolled)\n[[CHECK ok]]' }
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(nb().vocab[0].reps).toBe(1)
            expect(nb().history).toEqual([true])
            expect(chat.scriptstate[GRADED_FOR_VAR]).toContain('u1')
        })
        it('the same words sent again as a new line are graded again', () => {
            const chat: any = { message: [{ role: 'user', data: 'i i ê, i ri ma sên', chatId: 'u1' }, { role: 'char', data: 'a\n[[CHECK ok]]' }], scriptstate: { [VOCAB_VAR]: known } }
            noteLearningVocab(chat, 1_800_000_000_000)
            chat.message.push({ role: 'user', data: 'i i ê, i ri ma sên', chatId: 'u2' }, { role: 'char', data: 'c\n[[CHECK ok]]' })
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(nb().history).toEqual([true, true])
        })
        it('a check on a Vietnamese line is ignored: it does not count as a right answer', () => {
            const chat: any = { message: [{ role: 'user', data: 'Tôi đi chợ.' }, { role: 'char', data: 'a\n[[CHECK ok]]' }], scriptstate: {} }
            noteLearningVocab(chat, 1_800_000_000_000)
            expect(nb().history).toEqual([])
        })
    })
    it('a new chat brings back what was learned in another chat (the notebook is per language)', () => {
        const old: any = { message: [{ role: 'user', data: 'i cu ra dde su ca', chatId: 'u1' }, { role: 'char', data: '「いくら ですか」 (Bao nhiêu tiền?)\n[[CHECK ok]]' }], scriptstate: {} }
        noteLearningVocab(old, 1_000)
        const fresh: any = { message: [], scriptstate: {} }
        const note = learningRequest(req('x'), fresh, 1_000 + 3 * 86_400_000).find((m: any) => m.role === 'system').content
        expect(note).toContain('いくら ですか (Bao nhiêu tiền?)')
    })
    it('the note asks for extra practice on phrases often wrong', () => {
        db.learningNotebook = { ja: { vocab: JSON.stringify([{ text: 'はい', vietji: 'ha-i', meaning: 'Vâng', ok: 1, bad: 3 }]) } }
        const note = learningRequest(req('x'), { message: [], scriptstate: {} } as any).find((m: any) => m.role === 'system').content
        expect(note).toContain('often gets these wrong or mixes them up')
        expect(note).toContain('はい (Vâng)')
    })
})


describe('reported: "hết sức bình sinh tui leo lên được", built word by word, was coached as 병 → 아파요 (sick)', () => {
    it('the Vietnamese behind the picked words goes with the message, only the request carries it', () => {
        Object.assign(db, { learningLang: 'ko' })
        forgetThoughts()
        rememberThought('매우', 'hết sức')
        rememberThought('매우 병 태어나다 나 빨리 위 이기다', 'hết sức bình sinh tui leo lên được')
        const out = learningRequest(req('매우 병 태어나다 나 빨리 위 이기다'))
        const sent = out.filter((m: any) => m.role === 'user').pop().content
        expect(sent).toContain('«hết sức bình sinh tui leo lên được»')
        expect(learningRequest(req('안녕하세요')).filter((m: any) => m.role === 'user').pop().content).not.toContain('What the player meant')
        forgetThoughts()
    })
})

describe('the Vietnamese thought survives a reload', () => {
    it('is kept in this browser and read back', async () => {
        forgetThoughts()
        rememberThought('그렇게 개 거기 이다', 'thế cái đó là')
        expect(JSON.parse(localStorage.getItem('risu-vj-thoughts')!)).toEqual([{ text: '그렇게 개 거기 이다', viet: 'thế cái đó là' }])
        vi.resetModules()
        const fresh = await import('./learningThought')
        expect(fresh.thoughtFor('그렇게 개 거기 이다')).toBe('thế cái đó là')
        forgetThoughts()
    })
})

describe('reported: 😨 “아직 안전하지 않아요…” — no one could tell who said it', () => {
    it('the note and the reminder ask for the speaker name before every foreign line', () => {
        Object.assign(db, { learningLang: 'ko' })
        const out = learningRequest(req('안녕'))
        expect(out.find((m: any) => m.role === 'system').content).toContain('Every foreign line starts with who says it')
        expect(out.filter((m: any) => m.role === 'user').pop().content).toContain('starting with their name (Name: “…”)')
    })
})

describe('reported: あなた / 당신 in ordinary sentences', () => {
    it('the note asks the story to leave out the person spoken to in Korean and Japanese', () => {
        Object.assign(db, { learningLang: 'ja' })
        expect(learningRequest(req('こんにちは')).find((m: any) => m.role === 'system').content).toContain('never 당신 or あなた')
    })
})
