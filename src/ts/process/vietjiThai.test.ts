import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const db: any = { learningMode: true, learningReadings: true, learningLang: 'th' }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))

import { thaiToVietji, thaiUnits } from './vietjiThai'
import { addReadings, collectVocab, hasForeign, phraseVietji, splitReplies } from './vietji'
import { learningNote, learningReminder } from './learning'
import { foreignAt, foreignOfLine } from './tapToSpeak'
import { starterSet } from './vietjiSuggest'
import { FOREIGN_VOICE } from './ttsStream'
import { readInline, setReader } from './grammarCoach'
import { readFileSync } from 'node:fs'
import { romanSyllable, setThaiWords, thaiWords } from './vietjiThai'
import { buildThaiIndex, convert, imeSuggestions } from './vietjiIme'

// Readings checked against tltk's g2p (tone, final, length) through ~/.backend-review/work/risu-thai/compare.mjs; the comment
// says the rule each row holds up.
const GOLDEN: [string, string, string][] = [
    ['สวัสดี', 'xạ-oặt-đi', 'unwritten a, a sonorant borrows the high class (low on a dead syllable = nặng), w-glide oă'],
    ['ครับ', 'khrắp', 'true cluster คร, low class dead short = high'],
    ['ค่ะ', 'khả', 'low class + mai ek = falling (hỏi)'],
    ['ขอบคุณ', 'khọp-khun', 'high class dead = low, final บ = p'],
    ['ไม่เป็นไร', 'mảy-pên-ray', 'ไ is a short ai (ay), เ-็น'],
    ['ภาษาไทย', 'pha-xã-thay', 'ภ is aspirated ph, high class live = rising (ngã), ไ-ย with a silent ย'],
    ['ประเทศ', 'prạ-thểt', 'ประ cluster, low class dead long = falling, ศ final = t'],
    ['น้ำ', 'nám', 'said long though spelled short'],
    ['ข้าว', 'khảo', 'long aa + w = ao'],
    ['เข้าใจ', 'khảu-chay', 'เ-า is a short a + w = au'],
    ['เที่ยว', 'thiểu', 'เ-ีย + ว'],
    ['เพื่อน', 'phưởn', 'ươ takes the mark on ơ'],
    ['สวย', 'xuỗi', 'ว as the vowel ua before a final, uôi'],
    ['หนึ่ง', 'nừng', 'silent leading ห, low live = huyền'],
    ['สอง', 'xõng', 'high class live = rising (ngã)'],
    ['หก', 'hộc', 'unwritten o, high dead = low (nặng)'],
    ['เก้า', 'cảo', 'said long, mid + mai tho = falling'],
    ['เล็ก', 'lếch', 'final k after ê is ch'],
    ['ผู้หญิง', 'phủ-dĩnh', 'หญ = high y, final ng after i is nh'],
    ['อยู่', 'dù', 'silent อ before ย'],
    ['กวาง', 'quang', 'กว is qu'],
    ['ขวา', 'khoã', 'ขว is kho before a'],
    ['ความ', 'khoam', 'คว cluster'],
    ['เลย', 'lơi', 'เ-ย is ơi'],
    ['ก็', 'cỏ', 'ก็ is said falling'],
    ['อร่อย', 'ạ-ròi', 'อ leads ร: mid class + mai ek = low'],
    ['ขนม', 'khạ-nỗm', 'ข|นม, not ขน|ม; นม read high = rising'],
    ['ตลาด', 'tạ-lạt', 'ต leads ล: mid dead = low'],
    ['แสดง', 'xạ-đeng', 'a leading vowel over two consonants belongs to the second'],
    ['เสมอ', 'xạ-mỡ', 'เ-อ closes on the second consonant'],
    ['จันทร์', 'chăn', 'ทร์ is silent'],
    ['ศูนย์', 'xũn', 'ย์ alone is silent, น is the final'],
    ['สิทธิ์', 'xịt', 'ธิ์ is silent'],
    ['จริง', 'chinh', 'false cluster จร: the ร is silent'],
    ['ชาติ', 'chảt', 'Pali -ติ at the end: the vowel is silent'],
    ['แล้ว', 'léo', 'แ- + ว = eo'],
    ['เงิน', 'ngơn', 'เ-ิ with a final is ơ'],
    ['คน', 'khôn', 'unwritten o'],
    ['รถไฟ', 'rốt-fay', 'รถ|ไฟ, not ร|ถไฟ; ฟ is f'],
    ['โรงพยาบาล', 'rông-phá-da-ban', 'โรง|พยา|บาล; ร final = n'],
    ['กรุงเทพ', 'crung-thểp', 'กร cluster'],
    ['แปล', 'ple', 'a cluster wins over a final: ปล + แ, not แป + ล'],
    ['บัตร', 'bặt', 'a final then a silent ร'],
    ['การ์ด', 'cạt', 'ร์ silenced before the final ด'],
    ['ปลา', 'pla', 'ป is p (unaspirated)'],
    ['พ่อ', 'phỏ', 'พ is ph (aspirated), not f; low class + mai ek = falling'],
    ['ฟ้า', 'fá', 'ฟ is f'],
    ['กรรม', 'căm', '-รร- is a short a'],
    ['ฤดู', 'rứ-đu', 'ฤ alone is rư'],
    ['อังกฤษ', 'ăng-crịt', 'ฤ after a consonant is ri'],
]

describe('Thai readings (golden table)', () => {
    it.each(GOLDEN)('%s reads %s (%s)', (thai, viet) => expect(thaiToVietji(thai)).toBe(viet))
})

describe('Thai syllables as shown', () => {
    const cut = (s: string) => thaiUnits(s).map((u) => u.text)
    it('an unwritten-a syllable is shown with the one after it', () => {
        expect(cut('สวัสดีครับ')).toEqual(['สวัส', 'ดี', 'ครับ'])
        expect(thaiUnits('สวัสดีครับ').map((u) => u.vietji)).toEqual(['xạ-oặt', 'đi', 'khrắp'])
        expect(cut('ไปสถานีรถไฟ')).toEqual(['ไป', 'สถา', 'นี', 'รถ', 'ไฟ'])
    })
    it('a sentence without spaces is cut where the syllables end', () => {
        expect(cut('ผมรักคุณ')).toEqual(['ผม', 'รัก', 'คุณ'])
        expect(cut('อาหารไทยอร่อย')).toEqual(['อา', 'หาร', 'ไทย', 'อร่อย'])
        expect(cut('เรียบร้อย')).toEqual(['เรียบ', 'ร้อย'])
        expect(cut('ก็ตาม')).toEqual(['ก็', 'ตาม'])
    })
    it('ๆ repeats the syllable before it', () => {
        expect(thaiUnits('ใจเย็นๆ').map((u) => [u.text, u.vietji])).toEqual([['ใจ', 'chay'], ['เย็น', 'dên'], ['ๆ', 'dên']])
    })
    it('a stray mark is kept and not read', () => {
        expect(thaiUnits('่ดี').map((u) => [u.text, u.vietji])).toEqual([['่', null], ['ดี', 'đi']])
    })
})

describe('Thai tone rules', () => {
    // [syllable, Thai tone]: class (mid ก, high ข, low ค) × live/dead × tone mark
    const TONES: [string, string][] = [
        ['กา', 'mid'], ['ขา', 'rising'], ['คา', 'mid'], ['กะ', 'low'], ['คะ', 'high'], ['ขัด', 'low'], ['คัด', 'high'],
        ['คาด', 'falling'], ['ก่า', 'low'], ['ค่า', 'falling'], ['ก้า', 'falling'], ['ค้า', 'high'], ['ก๊า', 'high'], ['ก๋า', 'rising'],
    ]
    it.each(TONES)('%s is %s', (syl, tone) => expect(thaiUnits(syl)[0].syllables[0].tone).toBe(tone))
    it('the five tones become ngang, huyền/nặng, sắc, hỏi, ngã', () => {
        expect(['กา', 'ก่า', 'กะ', 'คะ', 'ก้า', 'ก๋า'].map((s) => thaiToVietji(s))).toEqual(['ca', 'cà', 'cạ', 'khá', 'cả', 'cã'])
    })
})

describe('Thai in the learning display', () => {
    it('every Thai syllable has its reading underneath, the Thai kept large', () => {
        const r = addReadings('Somchai: “สวัสดีครับ” (Xin chào)')
        expect(r).toContain('>สวัส</span><span')
        expect(r).toContain('>xạ-oặt</span>')
        expect(r).toContain('>khrắp</span>')
        expect(r).toContain('margin:0 .05em')
    })
    it('Thai counts as a foreign line', () => {
        expect(hasForeign('ขอบคุณ')).toBe(true)
        expect(hasForeign('cảm ơn')).toBe(false)
    })
    it('a phrase and the vocabulary get the reading', () => {
        expect(phraseVietji('สวัสดีครับ')).toBe('xạ-oặt-đi-khrắp')
        expect(collectVocab('Somchai: “ขอบคุณครับ” (Cảm ơn)')).toEqual([{ text: 'ขอบคุณครับ', vietji: 'khọp-khun-khrắp', meaning: 'Cảm ơn' }])
    })
    it('a suggested Thai answer is shown as Thai, not inside «»', () => {
        const { box } = splitReplies('…\n[[REPLIES\nไม่เป็นไร | Không sao | easy\n]]')
        expect(box).toContain('>mảy</span>')
        expect(box).not.toContain('«')
    })
    it('the starter phrases all have a reading', () => {
        const set = starterSet('th')
        expect(set.length).toBeGreaterThan(5)
        for (const s of set) expect(s.vietji, s.text).not.toBe('')
    })
})

describe('Thai for the model and the voice', () => {
    it('the note asks for Thai script, written normally', () => {
        const note = learningNote('th')
        expect(note).toContain('learning Thai')
        expect(note).toContain('no spaces between words')
        expect(note).toContain('no romanization')
        expect(learningReminder('th')).toContain('Thai script')
    })
    it('a tapped Thai word is read in a Thai voice', () => {
        expect(foreignAt('Somchai: สวัสดีครับ (Xin chào)', 11, 'th')).toEqual({ text: 'สวัสดีครับ', lang: 'th' })
        expect(foreignOfLine('Somchai: สวัสดีครับ (Xin chào)', 'th')).toBe('สวัสดีครับ')
        expect(FOREIGN_VOICE.th).toEqual({ device: 'th-TH' })
    })
    it('a Thai word inside a grammar explanation gets its reading', () => {
        setReader(phraseVietji)
        expect(readInline('Dạng lịch sự: ครับ')).toContain('>khrắp</span>')
    })
})

// ---- round 2: the word list (public/dict/th-words.json), word boundaries, ๆ, and the property checks ---------------------------

const LIST: Record<string, string> = JSON.parse(readFileSync('public/dict/th-words.json', 'utf8')).words

describe('with the word list', () => {
    beforeAll(() => setThaiWords(LIST))
    afterAll(() => setThaiWords(null))
    // tltk's dictionary reading, kept in the list where the spelling rules read otherwise: linking vowels no letter shows,
    // and the tones of words that break the class rule
    const LISTED: [string, string][] = [
        ['ผลไม้', 'phỗn-lá-mái'], ['โทรศัพท์', 'thô-rá-xặp'], ['ธรรมดา', 'thăm-má-đa'], ['พัฒนา', 'phắt-thá-na'], ['ปกติ', 'pộc-cạ-tị'],
        ['เจริญ', 'chạ-rơn'], ['สรุป', 'xạ-rụp'], ['กรุณา', 'cạ-rú-na'], ['ประโยค', 'prạ-dộc'], ['ประโยชน์', 'prạ-dột'],
        ['ตำรวจ', 'tăm-ruột'], ['สำเร็จ', 'xẵm-rệt'],
    ]
    it.each(LISTED)('%s reads %s', (thai, viet) => expect(thaiToVietji(thai)).toBe(viet))
    it('a listed reading is laid on the written syllables', () => {
        expect(thaiUnits('ผลไม้').map((u) => [u.text, u.vietji])).toEqual([['ผล', 'phỗn-lá'], ['ไม้', 'mái']])
        expect(romanSyllable('khwaam0')).toMatchObject({ onset: 'kh', glide: 'w', vowel: 'aa', long: true, coda: 'm', fixedTone: 'mid' })
        expect(romanSyllable('dUUat1')).toMatchObject({ onset: 'd', vowel: 'uea', long: true, coda: 't', fixedTone: 'low' })
    })
    it('words come from the list, the fewest of them, the more used on a tie', () => {
        const cut = (s: string) => thaiWords(s).map((w) => w.text)
        expect(cut('ราตรีสวัสดิ์')).toEqual(['ราตรี', 'สวัสดิ์'])
        expect(cut('ดีกว่า')).toEqual(['ดี', 'กว่า'])
        expect(cut('หมอบอกว่า')).toEqual(['หมอ', 'บอก', 'ว่า'])
        expect(thaiUnits('รูปร่าง').map((u) => u.text)).toEqual(['รูป', 'ร่าง'])
        expect(thaiUnits('ไปสถานีรถไฟ').map((u) => [u.text, u.wordStart])).toEqual([['ไป', true], ['สถา', true], ['นี', false], ['รถ', true], ['ไฟ', false]])
    })
    it('a stretch no word covers is read by the rules', () => {
        expect(thaiWords('ไปกขฃ').map((w) => [w.text, w.known])).toEqual([['ไป', true], ['กขฃ', false]])
        expect(thaiToVietji('ไปกขฃ')).toMatch(/^pay-/)
    })
    it('ๆ repeats the whole word before it', () => {
        expect(thaiUnits('ใจเย็นๆ').map((u) => [u.text, u.vietji])).toEqual([['ใจ', 'chay'], ['เย็น', 'dên'], ['ๆ', 'chay-dên']])
        expect(thaiUnits('พูดช้าๆหน่อย').map((u) => u.vietji)).toEqual(['phủt', 'chá', 'chá', 'nòi'])
    })
    it('a new word stands a little apart in the display', () => {
        expect(addReadings('ไปสถานี')).toContain('margin:0 .05em 0 .32em')
    })
    it('the sound typed in Việt-ji becomes Thai words', () => {
        const idx = buildThaiIndex(LIST)
        expect(convert(idx, 'xa oat di khrap')!.text).toBe('สวัสดีครับ')
        expect(convert(idx, 'may pên ray')!.text).toBe('ไม่เป็นไร')
        // after Thai already written, the chip joins it without a space (Thai has none between words)
        expect(imeSuggestions('สวัสดี khrap', idx).map((x) => x.replace)).toContain('สวัสดีครับ')
    })
})

describe('never loses or adds a letter', () => {
    // a seeded generator: the same thousands of cases every run
    const rng = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const words = Object.keys(LIST).slice(0, 3000)
    const thaiChar = (r: () => number) => String.fromCharCode(0x0E01 + Math.floor(r() * (0x0E4E - 0x0E01 + 1)))
    const thaiRun = (r: () => number) => {
        let s = ''
        const n = 1 + Math.floor(r() * 6)
        for (let k = 0; k < n; k++) s += r() < 0.6 ? words[Math.floor(r() * words.length)] : r() < 0.15 ? 'ๆ' : thaiChar(r)
        return s
    }
    const OTHER = ['0', '7', '๑', '๙', ' ', '  ', '.', ',', '!', '?', '-', 'abc', 'Somchai', 'x', '(', ')', ':', '“', '”', 'ฯ']
    const message = (r: () => number) => {
        let s = ''
        const n = 1 + Math.floor(r() * 8)
        for (let k = 0; k < n; k++) s += r() < 0.5 ? thaiRun(r) : OTHER[Math.floor(r() * OTHER.length)]
        return s
    }
    const strip = (html: string) => html
        .replace(/<span style="font-size:\.68em[^"]*">[^<]*<\/span>/g, '')        // the Việt-ji under each unit
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    it.each([['with the list', true], ['by the rules alone', false]])('a Thai run is cut into its own letters, %s', (_, withList) => {
        setThaiWords(withList ? LIST : null)
        const r = rng(withList ? 1 : 2)
        for (let k = 0; k < 3000; k++) {
            const run = thaiRun(r)
            const units = thaiUnits(run)
            expect(units.map((u) => u.text).join(''), run).toBe(run)
            expect(units.every((u) => u.text.length > 0), run).toBe(true)
            // a list word never ends right before a mark of its last consonant, nor right after a leading vowel
            let at = 0
            for (const w of thaiWords(run)) {
                at += w.text.length
                if (w.known && w.text !== 'ๆ' && at < run.length) expect(/[ัิีึืุู็่้๊๋ะาำๅ์]/.test(run[at]) || /[เแโใไ]/.test(run[at - 1]), `${run} @${at}`).toBe(false)
            }
        }
        setThaiWords(null)
    })
    it.each([['with the list', true], ['by the rules alone', false]])('the display keeps every letter of a message, %s', (_, withList) => {
        setThaiWords(withList ? LIST : null)
        const r = rng(withList ? 3 : 4)
        for (let k = 0; k < 2000; k++) {
            const msg = message(r)
            expect(strip(addReadings(msg)), msg).toBe(msg)
        }
        setThaiWords(null)
    })
})
