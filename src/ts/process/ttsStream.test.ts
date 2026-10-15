import { describe, expect, it } from 'vitest'
import { FrameParser } from './ttsStream'
import { foreignAt } from './tapToSpeak'
import { isLocalTTS } from './ttsLocal'

const frame = (kind: string, bytes: number[]) => new Uint8Array([kind.charCodeAt(0), 0, 0, (bytes.length >> 8) & 255, bytes.length & 255, ...bytes])

describe('the stream of MP3 chunks', () => {
    it('reads frames however the network cuts them', () => {
        const all = new Uint8Array([...frame('A', [1, 2, 3]), ...frame('A', [4]), ...frame('E', [104, 105])])
        for (let cut = 0; cut <= all.length; cut++) {
            const p = new FrameParser()
            const got = [...p.push(all.slice(0, cut)), ...p.push(all.slice(cut))]
            expect(got.map((f) => [f.kind, [...f.data]]), `cut at ${cut}`).toEqual([['audio', [1, 2, 3]], ['audio', [4]], ['error', [104, 105]]])
        }
    })
    it('a frame longer than 64 KB (a long chunk) is read whole', () => {
        const n = 70000
        const head = new Uint8Array([65, 0, (n >> 16) & 255, (n >> 8) & 255, n & 255])
        const p = new FrameParser()
        expect(p.push(head)).toEqual([])
        expect(p.push(new Uint8Array(n))[0].data.length).toBe(n)
    })
})

describe('tap a foreign word (the screenshot: 我 有 问题 in the learner\'s own message)', () => {
    it('Chinese: the whole run around the tap, spaces between words kept', () => {
        const t = 'Kenji nói: 我 有 问题'
        expect(foreignAt(t, t.indexOf('有'), 'zh')).toEqual({ text: '我 有 问题', lang: 'zh' })
        expect(foreignAt(t, t.length, 'zh')).toEqual({ text: '我 有 问题', lang: 'zh' })          // tap just after the last character
    })
    it('Japanese with bracketed readings: the readings are not read twice', () => {
        const t = '今日[きょう]は いい 天気[てんき]です。(Hôm nay trời đẹp.)'
        expect(foreignAt(t, 1, 'ja')).toEqual({ text: '今日は いい 天気です。', lang: 'ja' })
    })
    it('the script decides the language: kana is Japanese, hangul Korean, han alone follows the course', () => {
        expect(foreignAt('안녕하세요', 2, 'zh')?.lang).toBe('ko')
        expect(foreignAt('ありがとう', 0, 'zh')?.lang).toBe('ja')
        expect(foreignAt('学生', 0, 'ja')?.lang).toBe('ja')
        expect(foreignAt('学生', 0, 'ko')?.lang).toBe('zh')
    })
    it('Vietnamese around it is not read, and a line break ends the run', () => {
        const t = 'Ông ấy nói 你好\nrồi đi'
        expect(foreignAt(t, 2, 'zh')).toBe(null)
        expect(foreignAt(t, t.indexOf('你'), 'zh')).toEqual({ text: '你好', lang: 'zh' })
    })
    it('Spanish and French: the «phrase» the tap is in, never a Vietnamese word beside it', () => {
        const t = 'Ông lão nói «Hola, amigo» rồi cười. «Adiós»'
        expect(foreignAt(t, t.indexOf('amigo'), 'es')).toEqual({ text: 'Hola, amigo', lang: 'es' })
        expect(foreignAt(t, t.indexOf('cười'), 'es')).toBe(null)
        expect(foreignAt(t, t.indexOf('Adi'), 'fr')).toEqual({ text: 'Adiós', lang: 'fr' })
        expect(foreignAt('Xin chào bạn', 3, 'es')).toBe(null)
    })
})

it('only the pdf2mp3 server on this machine is streamed', () => {
    expect(isLocalTTS('http://localhost:8765/v1')).toBe(true)
    expect(isLocalTTS('http://127.0.0.1:8765/v1')).toBe(true)
    expect(isLocalTTS('https://api.openai.com/v1')).toBe(false)
    expect(isLocalTTS('http://localhost:9999/v1')).toBe(false)
})
