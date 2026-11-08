import { describe, expect, test } from 'vitest'
import { npcCardsNote } from './npcCheck.mjs'
import { fillNpcVoices, hasAttributedSpeech, namesNamedIn, npcVoicePrompt, onstageNpcs, rewireOnstageQuotes, speakingNamesIn, takeOneQuote } from './npcVoices.mjs'

const LEDGER = [
    '12 | aki | meet Aki;tớ;cậu;',
    '12 | naru | meet Naru;tớ;cậu;',
].join('\n')

const SCENE = 'Hành lang im.\n[[SAY|aki]]\nNaru đứng cạnh cửa.\n[[SAY|naru]]\n'

describe('npc voices', () => {
    test('the narrator note names the marker and does not ask the narrator to write the line', () => {
        const note = npcCardsNote(LEDGER, 13, true)
        expect(note).toContain('[[SAY|aki]]')
        expect(note).toContain('[[SAY|naru]]')
        expect(note).not.toContain('Each of them says')
        expect(npcCardsNote(LEDGER, 13)).toContain('Each of them says')
    })

    test('empty ledger still gets SAY markers from portrait extras', () => {
        const note = npcCardsNote('', 1, true, ['Aki', 'Naru'])
        expect(note).toContain('[[SAY|aki]]')
        expect(note).toContain('[[SAY|naru]]')
        expect(onstageNpcs('', 1, ['Aki', 'Naru']).map((c) => c.id)).toEqual(['aki', 'naru'])
    })

    test('on stage is the same three-reply window', () => {
        expect(onstageNpcs(LEDGER, 13).map((c) => c.id)).toEqual(['aki', 'naru'])
        expect(onstageNpcs(LEDGER, 20)).toEqual([])
    })

    test('a quote is one or two sentences', () => {
        expect(takeOneQuote('Aki nói: “Cậu quên hồ sơ à? Tớ thấy trên bàn. Mai tính.”')).toBe('Cậu quên hồ sơ à? Tớ thấy trên bàn.')
        expect(takeOneQuote('')).toBe('')
    })

    test('namesNamedIn keeps whole-word hits', () => {
        expect(namesNamedIn('Aki bám tay. Naru chạy theo.', ['Aki', 'Naru', 'Sayaka'])).toEqual(['Aki', 'Naru'])
        expect(namesNamedIn('Mưa rơi.', ['Aki'])).toEqual([])
    })

    test('speakingNamesIn requires attributed speech, not a mere mention', () => {
        expect(hasAttributedSpeech('Aki nói: “Đi.”', 'Aki')).toBe(true)
        expect(hasAttributedSpeech('"Đi." — Naru thì thầm', 'Naru')).toBe(true)
        expect(hasAttributedSpeech('Aki bám tay Yuuichi.', 'Aki')).toBe(false)
        expect(speakingNamesIn('Aki nói: “Đi.” Yuuichi đứng im.', ['Aki', 'Yuuichi', 'Naru'])).toEqual(['Aki'])
    })

    test('each marker is its own voice, and the next one hears the line just filled', async () => {
        const prompts: string[] = []
        const out = await fillNpcVoices(SCENE, LEDGER, 13, async (p: string) => {
            prompts.push(p)
            return prompts.length === 1 ? '“Cậu quên hồ sơ à?”' : '“Tớ để ở bàn rồi.”'
        })
        expect(out).toContain('Aki nói: “Cậu quên hồ sơ à?”')
        expect(out).toContain('Naru nói: “Tớ để ở bàn rồi.”')
        expect(out).not.toContain('[[SAY|')
        expect(prompts[1]).toContain('Aki nói: “Cậu quên hồ sơ à?”')
        expect(prompts[0]).not.toContain('Naru nói')
        expect(npcVoicePrompt(onstageNpcs(LEDGER, 13)[0], 'Hành lang im.')).toContain('Thẻ của bạn:')
    })

    test('Ollama-style reply without markers: attributed quotes are rewritten by the voice bots', async () => {
        const raw = 'Hành lang ồn.\nAki nói: “Đi nhanh lên.”\nNaru hét lên: “Chờ đã!”\n'
        const prompts: string[] = []
        const out = await fillNpcVoices(raw, '', 1, async (p: string) => {
            prompts.push(p)
            return prompts.length === 1 ? '“Cậu chậm quá.”' : '“Đứng lại đi!”'
        }, ['Aki', 'Naru'])
        expect(out).toContain('Aki nói: “Cậu chậm quá.”')
        expect(out).toContain('Naru hét lên: “Đứng lại đi!”')
        expect(prompts).toHaveLength(2)
        expect(prompts[1]).toContain('Cậu chậm quá')
        const kept = await rewireOnstageQuotes('Im lặng.', onstageNpcs('', 1, ['Aki']), async () => '“Hi.”')
        expect(kept).toBe('Im lặng.')
    })

    test('post-quote dash attributions rewrite only the spoken span', async () => {
        const raw = '"Chắc là tôi chạy hơi nhanh đi." — Naru thì thầm tự nói với bản thân\n“Ừ, chắc là vậy. Nhịp điệu hơi gấp gáp.” — Yuuichi gật đầu'
        const prompts: string[] = []
        const out = await fillNpcVoices(raw, '', 1, async () => {
            prompts.push('asked')
            return prompts.length === 1 ? '“Cậu nói đúng.”' : '“Mình nên chậm lại.”'
        }, ['Naru', 'Yuuichi'])
        expect(out).toBe('"Cậu nói đúng." — Naru thì thầm tự nói với bản thân\n“Mình nên chậm lại.” — Yuuichi gật đầu')
        expect(prompts).toHaveLength(2)
    })

    test('a failed voice or an unknown id drops the marker and keeps the scene', async () => {
        const dropped = await fillNpcVoices(SCENE, LEDGER, 13, async () => null)
        expect(dropped).toContain('Hành lang im.')
        expect(dropped).toContain('Naru đứng cạnh cửa.')
        expect(dropped).not.toContain('[[SAY|')
        expect(dropped).not.toContain('nói:')
        const unknown = await fillNpcVoices('Im.\n[[SAY|khong-co]]\n', LEDGER, 13, async () => '“Xin chào.”')
        expect(unknown).not.toContain('[[SAY|')
        expect(unknown).not.toContain('Xin chào')
        expect(await fillNpcVoices('Im lặng.', LEDGER, 13, async () => { throw new Error('no') })).toBe('Im lặng.')
    })
})
