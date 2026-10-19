import { describe, expect, it, vi } from 'vitest'

const db: any = { learningMode: true, learningReadings: true, learningLang: 'th' }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))

import { thaiToVietji, thaiUnits } from './vietjiThai'
import { addReadings, collectVocab, hasForeign, phraseVietji, splitReplies } from './vietji'
import { learningNote, learningReminder } from './learning'
import { foreignAt, foreignOfLine } from './tapToSpeak'
import { starterSet } from './vietjiSuggest'
import { FOREIGN_VOICE } from './ttsStream'
import { readInline, setReader } from './grammarCoach'

// Readings checked against tltk's g2p (tone, final, length) through ~/.backend-review/work/risu-thai/compare.mjs; the comment
// says the rule each row holds up.
const GOLDEN: [string, string, string][] = [
    ['สวัสดี', 'xạ-oặt-đi', 'unwritten a, a sonorant borrows the high class (low on a dead syllable = nặng), w-glide oă'],
    ['ครับ', 'khrắp', 'true cluster คร, low class dead short = high'],
    ['ค่ะ', 'khả', 'low class + mai ek = falling (hỏi)'],
    ['ขอบคุณ', 'khọp-khun', 'high class dead = low, final บ = p'],
    ['ไม่เป็นไร', 'mảy-pên-ray', 'ไ is a short ai (ay), เ-็น'],
    ['ภาษาไทย', 'pa-xã-thay', 'พ ภ are p, high class live = rising (ngã), ไ-ย with a silent ย'],
    ['ประเทศ', 'prạ-thểt', 'ประ cluster, low class dead long = falling, ศ final = t'],
    ['น้ำ', 'nám', 'said long though spelled short'],
    ['ข้าว', 'khảo', 'long aa + w = ao'],
    ['เข้าใจ', 'khảu-chay', 'เ-า is a short a + w = au'],
    ['เที่ยว', 'thiểu', 'เ-ีย + ว'],
    ['เมือง', 'mương', 'เ-ือ with a final'],
    ['เพื่อน', 'pưởn', 'ươ takes the mark on ơ'],
    ['สวย', 'xuỗi', 'ว as the vowel ua before a final, uôi'],
    ['หนึ่ง', 'nừng', 'silent leading ห, low live = huyền'],
    ['สอง', 'xõng', 'high class live = rising (ngã)'],
    ['สี่', 'xì', 'high class + mai ek = low'],
    ['หก', 'hộc', 'unwritten o, high dead = low (nặng)'],
    ['เจ็ด', 'chệt', 'เ-็ short e'],
    ['แปด', 'pẹt', 'แ-, mid dead = low'],
    ['เก้า', 'cảo', 'said long, mid + mai tho = falling'],
    ['เล็ก', 'lếch', 'final k after ê is ch'],
    ['ผู้หญิง', 'pủ-dĩnh', 'หญ = high y, final ng after i is nh'],
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
    ['รถไฟ', 'rốt-phay', 'รถ|ไฟ, not ร|ถไฟ; ฟ is ph'],
    ['โรงพยาบาล', 'rông-pá-da-ban', 'โรง|พยา|บาล; ร final = n'],
    ['กรุงเทพ', 'crung-thểp', 'กร cluster'],
    ['แปล', 'ple', 'a cluster wins over a final: ปล + แ, not แป + ล'],
    ['บัตร', 'bặt', 'a final then a silent ร'],
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
