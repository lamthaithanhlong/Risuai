// Việt-ji for Thai: every Thai syllable read by rule in Vietnamese letters with a Vietnamese tone mark (สวัสดี → xạ-oặt-đi).
//
// Thai writes no space between words, so a run of Thai is first cut into syllables by the spelling rules (a Thai Character
// Cluster style parser, no dictionary): a leading vowel เ แ โ ใ ไ belongs to the consonant after it, a consonant followed by a
// vowel or tone mark starts a syllable, true clusters (กร คล ปร ขว ...), a silent leading ห (หมา, ใหญ่) or อ (อยู่), the vowel
// shapes (เ-ีย, เ-ือ, -ัว, เ-าะ, -รร ...), one final consonant, and what ์ (karan) silences (จันทร์, ศาสตร์, สิทธิ์). When the
// spelling allows two cuts the one with the fewest syllables and the fewest unwritten vowels wins (ขนม = ข|นม, not ขน|ม).
// ๆ repeats the word before it (word boundaries come from the word list, below).
// A syllable with no written vowel that is not the last one is said with a short a (ส in สวัสดี, ข in ขนม) and is shown with
// the syllable after it, the way Thai readers group it (สวัส ดี: the unit is pythainlp's syllable, the reading has both).
//
// Tone (the rule every Thai school book teaches): consonant class (mid กจฎฏดตบปอ, high ขฃฉฐถผฝศษสห, low the rest) × live or
// dead syllable (dead = short open vowel, or a final k/t/p) × tone mark ่ ้ ๊ ๋. A sonorant after an unwritten-a high or mid
// consonant takes that consonant's class (ขนม: นม is read high, ข|หนม → khạ-nỗm; อร่อย → ạ-ròi).
//
// The five Thai tones as Vietnamese marks, chosen by ear against Hanoi Vietnamese, the textbook standard:
//   mid (33)         → ngang   the same level mid pitch
//   low (21)         → huyền   on a live syllable: Vietnamese huyền is also a low fall (21);
//                      nặng    on a dead one: a Vietnamese syllable ending in c/t/p only takes sắc or nặng, nặng is the low one,
//                              and the glottal catch of nặng is how a Thai short vowel ends (ขอบ = khọp, สวัสดี = xạ-oặt-đi)
//   high (45)        → sắc     high and rising at the end (ครับ = khrắp, น้ำ = nắm)
//   falling (41)     → hỏi     Hanoi hỏi starts mid and falls (31); no other mark falls from above the middle (ไม่ = mảy)
//   rising (24)      → ngã     Hanoi ngã starts low and rises; Thai rising does the same without the break (สอง = xõng)
// Southern speakers say hỏi and ngã alike, so for them falling and rising look different but sound alike: the one loss.
//
// Letters: Vietnamese spelling rules are kept (c/k/q, ng/ngh, ch/nh after i and ê, oa/uy for a w-glide, ay/au for a short
// a before i/u: ไทย = thay, เขา = khẫu, against ข้าว = khảo). A short a before another final is ă (วัส = oặt). ย/ญ are d, as
// や = da in the Japanese table.
// Aspiration keeps three pairs apart the way Vietnamese already writes two of them: t (ต, unaspirated, Vietnamese t) against th
// (ท ถ ฐ ฑ ฒ ธ, aspirated, Vietnamese th), c/k (ก) against kh (ข ค ฆ), and so p (ป) against ph (พ ผ ภ). Vietnamese reads ph as
// f, so ph here is a convention to learn once ("p with a puff", like th), and ฟ ฝ, the real f, are written f; d (ด) and b (บ)
// are Vietnamese đ and b. By ear: a Vietnamese t/th/c/kh already falls on the Thai side of each pair, so only ph is new.
// These are readings for a beginner to say aloud, not phonetics.

import { toneSyllable, type VietTone } from './vietjiLang'

export type ThaiTone = 'mid' | 'low' | 'falling' | 'high' | 'rising'
type ThaiClass = 'mid' | 'high' | 'low'

const MID = 'กจฎฏดตบปอ'
const HIGH = 'ขฃฉฐถผฝศษสห'
const SONORANT = 'งญณนมยรลวฬ'
const LEADS = 'เแโใไ'
const MARKS = 'ัิีึืุู็'                     // vowel marks written above or below a consonant
const TONE_MARKS = '่้๊๋'                    // mai ek, mai tho, mai tri, mai chattawa
const KARAN = '์'
const REPEAT = 'ๆ'

const isCons = (c: string | undefined) => !!c && c >= 'ก' && c <= 'ฮ' && c !== 'ฤ' && c !== 'ฦ'
/** A character that only follows a consonant of its own syllable: the consonant before it starts that syllable. */
const binds = (c: string | undefined) => !!c && (MARKS.includes(c) || TONE_MARKS.includes(c) || 'ะาำๅ'.includes(c))
const classOf = (c: string): ThaiClass => (MID.includes(c) ? 'mid' : HIGH.includes(c) ? 'high' : 'low')

// the sound each consonant starts a syllable with, and the one it ends a syllable with
const ONSET: Record<string, string> = {}
for (const [sound, letters] of Object.entries({
    k: 'ก', kh: 'ขฃคฅฆ', ng: 'ง', ch: 'จฉชฌ', s: 'ซศษส', y: 'ญย', d: 'ฎด', t: 'ฏต', th: 'ฐฑฒถทธ', n: 'ณน', b: 'บ', p: 'ป', ph: 'ผพภ',
    f: 'ฝฟ', m: 'ม', r: 'ร', l: 'ลฬ', w: 'ว', h: 'หฮ', '': 'อ',
})) for (const c of letters) ONSET[c] = sound
const CODA: Record<string, string> = {}
for (const [sound, letters] of Object.entries({
    k: 'กขคฆฃฅ', t: 'จชซฌฎฏฐฑฒดตถทธศษสฉ', p: 'บปพฟภผฝ', n: 'ญณนรลฬ', m: 'ม', ng: 'ง', j: 'ย', w: 'ว',
})) for (const c of letters) CODA[c] = sound

// true clusters (the second consonant is said), false ones (ร is silent and the pair has its own sound)
const TRUE_CLUSTER = new Set(['กร', 'กล', 'กว', 'ขร', 'ขล', 'ขว', 'คร', 'คล', 'คว', 'ตร', 'ปร', 'ปล', 'พร', 'พล', 'ผล', 'บร', 'บล', 'ดร', 'ฟร', 'ฟล'])
// clusters that start few native words: a consonant before them more often closes the syllable before (เรียบ|ร้อย,
// เดือด|ร้อน, บอก|ว่า), so on a tie they lose. ผล is mostly phǒn (ผลไม้), rarely phl.
const RARE_CLUSTER: Record<string, number> = { บร: 0.1, บล: 0.1, ดร: 0.1, ฟร: 0.1, ฟล: 0.1, กว: 0.1, ผล: 0.3 }
const FALSE_CLUSTER: Record<string, [string, ThaiClass]> = { ทร: ['s', 'low'], ซร: ['s', 'low'], ศร: ['s', 'high'], สร: ['s', 'high'], จร: ['ch', 'mid'] }
const OY_WORDS = ['อยู่', 'อย่า', 'อยาก']               // the only words where อ is a silent lead before ย

type Final = 'none' | 'opt' | 'req'
// [leading vowel, what follows the onset (tone marks left out), vowel, final rule, vowel is long]
const TEMPLATES: [string, string, string, Final, boolean][] = [
    ['', 'ัวะ', 'ua', 'none', false], ['', 'ัว', 'ua', 'none', true], ['', 'ั', 'a', 'req', false], ['', 'ะ', 'a', 'none', false],
    ['', 'า', 'aa', 'opt', true], ['', 'ำ', 'am', 'none', false], ['', 'ิ', 'i', 'opt', false], ['', 'ี', 'i', 'opt', true],
    ['', 'ึ', 'ue', 'opt', false], ['', 'ือ', 'ue', 'none', true], ['', 'ื', 'ue', 'req', true], ['', 'ุ', 'u', 'opt', false],
    ['', 'ู', 'u', 'opt', true], ['', '็อ', 'or', 'req', false], ['', 'อ', 'or', 'opt', true], ['', 'ว', 'ua', 'req', true],
    ['', 'รร', 'a', 'opt', false], ['', 'ฤ', 'ri', 'opt', false], ['', '', 'o', 'opt', false],
    ['เ', 'ียะ', 'ia', 'none', false], ['เ', 'ีย', 'ia', 'opt', true], ['เ', 'ือะ', 'uea', 'none', false], ['เ', 'ือ', 'uea', 'opt', true],
    ['เ', 'าะ', 'or', 'none', false], ['เ', 'า', 'ao', 'none', false], ['เ', 'อะ', 'oe', 'none', false], ['เ', 'อ', 'oe', 'none', true],
    ['เ', 'ิ', 'oe', 'req', true], ['เ', 'ย', 'oe', 'none', true], ['เ', '็', 'e', 'req', false], ['เ', 'ะ', 'e', 'none', false],
    ['เ', '', 'e', 'opt', true],
    ['แ', '็', 'ae', 'req', false], ['แ', 'ะ', 'ae', 'none', false], ['แ', '', 'ae', 'opt', true],
    ['โ', 'ะ', 'o', 'none', false], ['โ', '', 'o', 'opt', true],
    ['ใ', '', 'ai', 'none', false], ['ไ', 'ย', 'ai', 'none', false], ['ไ', '', 'ai', 'none', false],
]

export type Syl = {
    onset: string           // the sound the syllable starts with: 'k', 'kh', 's', '' ...
    glide: string           // '' or the cluster's second sound: 'r', 'l', 'w'
    cls: ThaiClass
    single: string          // the onset letter when it is one sonorant letter (for the class it may borrow), else ''
    vowel: string
    long: boolean
    coda: string            // '', 'k', 't', 'p', 'n', 'm', 'ng', 'j', 'w'
    mark: number            // 0 none, 1 ่, 2 ้, 3 ๊, 4 ๋
    unwritten: '' | 'a' | 'o'
    fixedTone?: ThaiTone
}
type Cand = { syls: Syl[]; end: number; cost: number }
// The cost of a cut: 1 a syllable, more for a vowel that is not written. A consonant said with an unwritten a mostly leads a
// sonorant (ส|วัส, ข|นม, พ|ยา): before one it costs a little less than an unwritten o, so the consonant before closes the
// syllable before it (โรง|พยา, not โร|งพ|ยา); before any other consonant a little more (รถ|ไฟ, not ร|ถไฟ; ตก|ลง, not ต|กลง).
const UNWRITTEN_A = 1.45
const UNWRITTEN_O = 1.5

/** The syllables (one, or two when a leading vowel belongs to the second consonant) that can start at s[i]. */
function parseAt(s: string[], i: number): Cand[] {
    const out: Cand[] = []
    const lead = LEADS.includes(s[i]) ? s[i] : ''
    const j = i + (lead ? 1 : 0)
    if (s[i] === 'ฤ' || s[i] === 'ฦ') {                                     // ฤ alone: rư (ฤดู)
        out.push({ syls: [mk('r', '', 'low', 'ร', 'ue', false, '', 0, 'a')], end: i + 1, cost: 1 })   // shown with what follows
        return out
    }
    if (!isCons(s[j])) return out
    if (s[j] === 'ก' && s[j + 1] === '็' && !lead && s[j + 2] !== 'อ') {
        out.push({ syls: [{ ...mk('k', '', 'mid', '', 'or', false, '', 0, ''), fixedTone: 'falling' }], end: j + 2, cost: 1 })   // ก็
    }
    // onsets: one consonant, or two read as one
    // a pair read as one onset is tried first: on a tie (แปล: ปล + แ, or แป + final ล) the cluster wins
    const onsets: { onset: string; glide: string; cls: ThaiClass; single: string; k: number; cost: number }[] = []
    const c1 = s[j], c2 = s[j + 1]
    if (isCons(c2)) {
        const pair = c1 + c2
        if (TRUE_CLUSTER.has(pair)) onsets.push({ onset: ONSET[c1], glide: ONSET[c2], cls: classOf(c1), single: '', k: j + 2, cost: RARE_CLUSTER[pair] ?? 0 })
        else if (FALSE_CLUSTER[pair]) onsets.push({ onset: FALSE_CLUSTER[pair][0], glide: '', cls: FALSE_CLUSTER[pair][1], single: '', k: j + 2, cost: 0.1 })
        else if (c1 === 'ห' && SONORANT.includes(c2)) onsets.push({ onset: ONSET[c2], glide: '', cls: 'high', single: '', k: j + 2, cost: 0 })
        else if (c1 === 'อ' && c2 === 'ย' && !lead && OY_WORDS.some((w) => s.slice(j, j + w.length).join('') === w)) onsets.push({ onset: 'y', glide: '', cls: 'mid', single: '', k: j + 2, cost: 0 })
    }
    onsets.push({ onset: ONSET[c1], glide: '', cls: classOf(c1), single: SONORANT.includes(c1) ? c1 : '', k: j + 1, cost: 0 })
    for (const on of onsets) {
        for (const [tLead, body, vowel, finalRule, long] of TEMPLATES) {
            if (tLead !== lead) continue
            // match the body, tone marks allowed anywhere in it
            let p = on.k, mark = 0, ok = true
            const skipMarks = () => { while (TONE_MARKS.includes(s[p] ?? '-')) { mark = TONE_MARKS.indexOf(s[p]) + 1; p++ } }
            skipMarks()
            for (const ch of body) {
                if (s[p] !== ch) { ok = false; break }
                p++
                skipMarks()
            }
            if (!ok) continue
            if (body === '' && (binds(s[p]) || (lead === '' && s[p] === 'อ' && !binds(s[p + 1])))) continue
            const base = mk(on.onset, on.glide, on.cls, on.single, vowel, long, '', mark, '')
            const add = (syl: Syl, end: number, cost: number) => out.push({ syls: [syl], end: silentTail(s, end, !!syl.coda), cost: on.cost + cost })
            const finalOk = isCons(s[p]) && !'อหฮ'.includes(s[p]) && !binds(s[p + 1]) && CODA[s[p]] !== undefined
            if (body === 'รร') {
                if (finalOk) add({ ...base, coda: CODA[s[p]] }, p + 1, 1)
                add({ ...base, coda: 'n' }, p, 1.1)
                continue
            }
            if (body === '' && !lead) {
                // no written vowel: an unwritten o with a final (คน, รถ; พร is phɔɔn), or an unwritten a
                if (finalOk && !'วย'.includes(s[p])) {
                    const r = s[p] === 'ร'
                    add({ ...base, vowel: r ? 'or' : 'o', long: r, coda: CODA[s[p]], unwritten: 'o' }, p + 1, UNWRITTEN_O)
                }
                add({ ...base, vowel: 'a', long: false, unwritten: 'a' }, p, SONORANT.includes(s[p] ?? '-') ? UNWRITTEN_A : UNWRITTEN_A + 0.1)
                continue
            }
            const fixedFinal = (lead === 'เ' && body === 'ย') ? 'j' : ''
            // ไ-ย is ไทย (and a few rare words), where ย is silent; read as ไท|ย... it would steal the next syllable's onset
            if (finalRule !== 'req') add({ ...base, coda: fixedFinal }, p, body === 'ว' ? 1.2 : lead === 'ไ' && body === 'ย' ? 0.2 : 1)
            // Pali -ติ -ตุ at the end of a word: the vowel is silent and ต closes the syllable (ชาติ, ญาติ, เหตุ, ธาตุ, ประวัติ)
            if (finalRule !== 'none' && s[p] === 'ต' && 'ิุ'.includes(s[p + 1] ?? '-') && p + 2 === s.length && !TONE_MARKS.includes(s[p + 2] ?? '-')) {
                add({ ...base, coda: 't' }, p + 2, 1.1)
            }
            // a silenced consonant before the final, in loanwords: การ์ด, ฟิล์ม, เวิร์ด (ร์ is not said, ด closes)
            if (finalRule !== 'none' && isCons(s[p]) && s[p + 1] === KARAN && isCons(s[p + 2]) && s[p + 2] !== 'อ' && !binds(s[p + 3]) && s[p + 3] !== KARAN && CODA[s[p + 2]] !== undefined) {
                add({ ...base, coda: CODA[s[p + 2]] }, p + 3, 1)
            }
            if (finalRule !== 'none' && finalOk && s[p + 1] !== KARAN) {
                add({ ...base, coda: CODA[s[p]] }, p + 1, body === 'ว' ? 1.2 : 1)
                // a final consonant then a silent ร (บัตร, สมุทร, เพชร)
                if (s[p + 1] === 'ร' && !binds(s[p + 2]) && s[p + 2] !== KARAN && s[p + 2] !== 'ร') add({ ...base, coda: CODA[s[p]] }, p + 2, 1.4)
            }
        }
    }
    // a leading vowel over two consonants that are no cluster belongs to the second; the first is said with a short a
    // (แสดง = sa-dɛɛŋ, เสมอ = sa-mə̌ə, ไฉน = cha-nǎj)
    // (ร ล ว ย ง อ never lead another consonant this way: โรงพยาบาล is โรง|พยา|บาล; ไ ใ almost never: ไป|สถา|นี)
    if (lead && !'ไใ'.includes(lead) && isCons(s[j + 1]) && !onsets.some((o) => o.k === j + 2) && !'รลวยงอ'.includes(s[j])) {
        const rest = [lead, ...s.slice(j + 1)]
        const first = mk(ONSET[s[j]], '', classOf(s[j]), '', 'a', false, '', 0, 'a')
        for (const c of parseAt(rest, 0)) {
            if (c.syls.length !== 1) continue
            out.push({ syls: [first, c.syls[0]], end: j + c.end, cost: c.cost + UNWRITTEN_A })
        }
    }
    return out
}

function mk(onset: string, glide: string, cls: ThaiClass, single: string, vowel: string, long: boolean, coda: string, mark: number, unwritten: '' | 'a' | 'o'): Syl {
    return { onset, glide, cls, single, vowel, long, coda, mark, unwritten }
}

/** What ์ silences after a syllable: the consonant it sits on (ร์), with a vowel mark (ธิ์), or two consonants after a final
 *  (จันทร์, ศาสตร์; ศูนย์ is ศูน + ย์, not ศู + นย์). */
function silentTail(s: string[], end: number, hasCoda: boolean): number {
    if (isCons(s[end]) && s[end + 1] === KARAN) return end + 2
    if (isCons(s[end]) && 'ิุ'.includes(s[end + 1] ?? '-') && s[end + 2] === KARAN) return end + 3
    if (hasCoda && isCons(s[end]) && isCons(s[end + 1]) && s[end + 2] === KARAN) return end + 3
    return end
}

/** A run of Thai cut into syllables: the cut with the lowest cost (fewest syllables, fewest unwritten vowels). */
function parseRun(run: string): { text: string; syls: Syl[] }[] {
    const s = [...run]
    const best: ({ cost: number; prev: number; cand: Cand | null } | null)[] = Array(s.length + 1).fill(null)
    best[0] = { cost: 0, prev: -1, cand: null }
    for (let i = 0; i < s.length; i++) {
        if (!best[i]) continue
        const cands = s[i] === REPEAT ? [{ syls: [], end: i + 1, cost: 0 }] : parseAt(s, i)
        if (!cands.length) cands.push({ syls: [], end: i + 1, cost: 10 })       // a stray mark: kept, not read
        for (const c of cands) {
            const last = c.syls[c.syls.length - 1]
            const cost = best[i]!.cost + c.cost + (lead(s, i) && last && !last.coda && c.end < s.length && opensOr(s, c.end) ? 2 : 0)
            if (!best[c.end] || cost < best[c.end]!.cost) best[c.end] = { cost, prev: i, cand: c }
        }
    }
    const pieces: { text: string; syls: Syl[] }[] = []
    for (let e = s.length; e > 0;) {
        const b = best[e]!
        pieces.unshift({ text: s.slice(b.prev, e).join(''), syls: b.cand!.syls })
        e = b.prev
    }
    return pieces
}
const lead = (s: string[], i: number) => LEADS.includes(s[i])
// an open syllable with a leading vowel followed by C+อ (เส|มอ): the อ closes the leading vowel (เสมอ = ส + เมอ)
const opensOr = (s: string[], i: number) => isCons(s[i]) && s[i + 1] === 'อ' && !binds(s[i + 2]) && !isCons(s[i + 2])

function toneOf(syl: Syl, cls: ThaiClass): ThaiTone {
    if (syl.fixedTone) return syl.fixedTone
    const live = syl.coda ? !'ktp'.includes(syl.coda) : syl.long || ['am', 'ai', 'ao'].includes(syl.vowel)
    switch (syl.mark) {
        case 1: return cls === 'low' ? 'falling' : 'low'
        case 2: return cls === 'low' ? 'high' : 'falling'
        case 3: return 'high'
        case 4: return 'rising'
    }
    if (cls === 'mid') return live ? 'mid' : 'low'
    if (cls === 'high') return live ? 'rising' : 'low'
    return live ? 'mid' : syl.long ? 'falling' : 'high'
}

const CODA_VI: Record<string, string> = { '': '', k: 'c', t: 't', p: 'p', n: 'n', m: 'm', ng: 'ng', j: 'i', w: 'u' }

/** The vowel and final in Vietnamese letters. */
function rhyme(v: string, long: boolean, coda: string): string {
    const c = CODA_VI[coda]
    switch (v) {
        case 'a': return !coda ? 'a' : coda === 'j' ? 'ay' : coda === 'w' ? 'au' : 'ă' + c
        case 'aa': return !coda ? 'a' : coda === 'j' ? 'ai' : coda === 'w' ? 'ao' : 'a' + c
        case 'am': return long ? 'am' : 'ăm'
        case 'ai': return long ? 'ai' : 'ay'
        case 'ao': return long ? 'ao' : 'au'
        case 'i': return coda === 'k' ? 'ich' : coda === 'ng' ? 'inh' : 'i' + c
        case 'ue': return 'ư' + c
        case 'u': return 'u' + c
        case 'e': return coda === 'k' ? 'êch' : coda === 'ng' ? 'ênh' : 'ê' + c
        case 'ae': return coda === 'w' ? 'eo' : 'e' + c
        case 'o': return 'ô' + c
        case 'or': return 'o' + c
        case 'oe': return 'ơ' + c
        case 'ia': return !coda ? 'ia' : 'iê' + c
        case 'uea': return !coda ? 'ưa' : 'ươ' + c
        case 'ua': return !coda ? 'ua' : 'uô' + c
    }
    return v + c                                                // ri: ฤ after a consonant (กฤษ = crit)
}

const ONSET_VI: Record<string, string> = {
    k: 'c', kh: 'kh', ng: 'ng', ch: 'ch', s: 'x', y: 'd', d: 'đ', t: 't', th: 'th', n: 'n', b: 'b', p: 'p', ph: 'ph', f: 'f', m: 'm', r: 'r',
    l: 'l', h: 'h', '': '',
}

function vietTone(t: ThaiTone, dead: boolean): VietTone {
    return t === 'mid' ? 'ngang' : t === 'low' ? (dead ? 'nang' : 'huyen') : t === 'high' ? 'sac' : t === 'falling' ? 'hoi' : 'nga'
}

/** One syllable in Vietnamese letters with its tone mark. */
function spell(syl: Syl, tone: ThaiTone): string {
    let r = rhyme(syl.vowel, syl.long, syl.coda)
    let on = ONSET_VI[syl.onset] ?? ''
    const w = syl.onset === 'w' || syl.glide === 'w'
    if (w) {
        if (syl.onset === 'k') { on = 'qu'; r = r.replace(/^i/, 'y') }
        else {
            on = syl.onset === 'w' ? '' : on
            if (/^[aăe]/.test(r)) r = 'o' + r
            else if (/^[êâơiy]/.test(r)) r = 'u' + r.replace(/^i/, 'y')
            else if (syl.onset === 'w') on = 'v'
        }
    } else if (syl.glide) {
        on += syl.glide
    } else {
        if (on === 'c' && /^[eêiy]/.test(r)) on = 'k'
        if (on === 'ng' && /^[eêi]/.test(r)) on = 'ngh'
        if (on === '' && r.startsWith('iê')) r = 'y' + r.slice(1)
    }
    const dead = 'ktp'.includes(syl.coda || '-') || (!syl.coda && !syl.long && !['am', 'ai', 'ao'].includes(syl.vowel))
    return on + toneSyllable(r, vietTone(tone, dead))
}

export type ThaiSyllable = { vietji: string; tone: ThaiTone; vowel: string; coda: string; long: boolean }
/** A unit of written Thai (a syllable as Thai readers cut it) and its syllables as said; wordStart: the first unit of a word. */
export type ThaiUnit = { text: string; syllables: ThaiSyllable[]; vietji: string | null; wordStart?: boolean }

export const THAI_RUN = /[ก-ฺเ-๎]+/g
export const THAI = /[ก-ฺเ-๎]/

// ---- the word list -----------------------------------------------------------------------------------------------------------
//
// public/dict/th-words.json (scripts/build_th_dict.mjs): the 20,000 most used Thai words, each "" when the rules above read it
// the way tltk's dictionary g2p does, else tltk's reading: written units with their lengths and the syllables said in each,
// "2phon4'la3~3maaj3" for ผลไม้ (ผล said phǒn-la, a linking vowel no spelling shows; tones 0 mid 1 low 2 falling 3 high
// 4 rising). Loaded by the bar while learning Thai; until then, and for any word not in it, the rules read alone.
// The list also gives the word boundaries: a run is cut into the fewest words it can (maximal matching), a stretch that no
// word covers is cut by the rules, so ราตรี|สวัสดิ์ and ดี|กว่า are cut where the words end, not where a spelling allows.

let words: Map<string, string> | null = null
let rank: Map<string, number> = new Map()                 // the list is most used first
let longest = 0
const decoded = new Map<string, ThaiUnit[]>()

export function setThaiWords(list: Record<string, string> | null): void {
    words = list ? new Map(Object.entries(list)) : null
    rank = new Map([...(words?.keys() ?? [])].map((w, k) => [w, k]))
    longest = 0
    for (const w of words?.keys() ?? []) longest = Math.max(longest, w.length)
    decoded.clear()
}

const ROMAN_ONSETS = ['khr', 'khl', 'khw', 'phr', 'phl', 'thr', 'kr', 'kl', 'kw', 'pr', 'pl', 'tr', 'br', 'bl', 'dr', 'fr', 'fl',
    'ch', 'kh', 'ph', 'th', 'p', 't', 'c', 'k', '?', 'b', 'd', 'm', 'n', 'N', 'f', 's', 'h', 'j', 'w', 'l', 'r']
const ROMAN_ONSET: Record<string, string> = { c: 'ch', '?': '', N: 'ng', j: 'y' }
const ROMAN_VOWELS: [string, string, boolean][] = [
    ['iia', 'ia', true], ['UUa', 'uea', true], ['uua', 'ua', true], ['ia', 'ia', false], ['Ua', 'uea', false], ['ua', 'ua', false],
    ['aa', 'aa', true], ['ii', 'i', true], ['UU', 'ue', true], ['uu', 'u', true], ['ee', 'e', true], ['xx', 'ae', true],
    ['oo', 'o', true], ['OO', 'or', true], ['@@', 'oe', true], ['a', 'a', false], ['i', 'i', false], ['U', 'ue', false],
    ['u', 'u', false], ['e', 'e', false], ['x', 'ae', false], ['o', 'o', false], ['O', 'or', false], ['@', 'oe', false],
]
// tltk's vowels: U is ɯ (ư), x is ɛ (e), O is ɔ (o), @ is ə (ơ), a doubled letter is long; a loanword may end in l or s, said n, t
const ROMAN_CODA: Record<string, string> = { '': '', '?': '', p: 'p', t: 't', k: 'k', m: 'm', n: 'n', N: 'ng', j: 'j', w: 'w', l: 'n', s: 't', f: 'p' }
const ROMAN_TONE: ThaiTone[] = ['mid', 'low', 'falling', 'high', 'rising']

/** One syllable of tltk's romanization ("phon4") as a syllable to spell; null when it is not one. */
export function romanSyllable(roman: string): Syl | null {
    const m = /^(.+?)([0-4])$/.exec(roman)
    if (!m) return null
    for (const on of ROMAN_ONSETS) {
        if (!m[1].startsWith(on)) continue
        const rest = m[1].slice(on.length)
        for (const [v, vowel, long] of ROMAN_VOWELS) {
            if (!rest.startsWith(v)) continue
            const coda = ROMAN_CODA[rest.slice(v.length)]
            if (coda === undefined) continue
            const second = on.length > 1 && 'rlw'.includes(on[on.length - 1]) && on !== 'kh' ? on[on.length - 1] : ''
            const first = second ? on.slice(0, -1) : on
            const onset = ROMAN_ONSET[first] ?? first
            return { onset, glide: second, cls: 'mid', single: '', vowel, long, coda, mark: 0,
                unwritten: '', fixedTone: ROMAN_TONE[Number(m[2])] }
        }
    }
    return null
}

/** A word's units from its list entry ("2phon4'la3~3maaj3"); null when the entry cannot be read. */
function listedUnits(word: string, entry: string): ThaiUnit[] | null {
    if (decoded.has(word)) return decoded.get(word)!
    const units: ThaiUnit[] = []
    let at = 0
    for (const part of entry.split('~')) {
        const m = /^(\d+)(.+)$/.exec(part)
        if (!m) return null
        const syls = m[2].split("'").map(romanSyllable)
        if (syls.some((x) => !x)) return null
        units.push(toUnit(word.slice(at, at + Number(m[1])), syls as Syl[], false))
        at += Number(m[1])
    }
    if (at !== word.length) return null
    decoded.set(word, units)
    return units
}

/** Where a word may end: not before a mark that belongs to the consonant before it, not right after a leading vowel. */
const canEnd = (s: string[], e: number) => e === s.length || (!binds(s[e]) && s[e] !== KARAN && !LEADS.includes(s[e - 1]))

/** A run cut into words: list words where they fit, the fewest pieces; a stretch no word covers is one piece for the rules. */
export function thaiWords(run: string): { text: string; known: boolean }[] {
    const s = [...run]
    if (!words) return run ? [{ text: run, known: false }] : []
    // cost: a listed word 1, a syllable no word covers 2 (so a word always wins over cutting the same letters by rule); among
    // cuts into as many words, the more used words win (หมอ|บอก|ว่า, not หมอ|บอ|กว่า): a word adds 0.04 per power of ten of its rank
    // in the list, at most 0.18, so it never outweighs a word more
    const best: ({ cost: number; prev: number; known: boolean } | null)[] = Array(s.length + 1).fill(null)
    best[0] = { cost: 0, prev: -1, known: true }
    const relax = (i: number, e: number, cost: number, known: boolean) => {
        const c = best[i]!.cost + cost
        if (!best[e] || c < best[e]!.cost) best[e] = { cost: c, prev: i, known }
    }
    for (let i = 0; i < s.length; i++) {
        if (!best[i]) continue
        if (s[i] === REPEAT) { relax(i, i + 1, 0, true); continue }
        for (let n = Math.min(longest, s.length - i); n >= 1; n--) {
            const w = s.slice(i, i + n).join('')
            if (words.has(w) && canEnd(s, i + n)) relax(i, i + n, 1 + 0.04 * Math.log10((rank.get(w) ?? 0) + 1), true)
        }
        const cands = parseAt(s, i)
        for (const c of cands) relax(i, c.end, 2 * Math.max(1, c.syls.length), false)
        if (!cands.length) relax(i, i + 1, 10, false)
    }
    const cut: { text: string; known: boolean }[] = []
    for (let e = s.length; e > 0;) {
        const b = best[e]!
        const text = s.slice(b.prev, e).join('')
        // unknown pieces next to each other are one stretch: the rules cut it as a whole (their own costs decide inside)
        if (!b.known && cut.length && !cut[0].known) cut[0] = { text: text + cut[0].text, known: false }
        else cut.unshift({ text, known: b.known })
        e = b.prev
    }
    return cut
}

/**
 * A run of Thai cut into the units shown one by one, each with its reading. A syllable said with an unwritten a is joined to the
 * syllable after it (สวัส|ดี); ๆ is its own unit and repeats the word before it (เด็กๆ = đệch-đệch, ช้าๆ).
 */
export function thaiUnits(run: string): ThaiUnit[] {
    const out: ThaiUnit[] = []
    let prev: ThaiUnit[] = []
    for (const w of thaiWords(run)) {
        if (w.text === REPEAT) {
            const syllables = prev.flatMap((u) => u.syllables)
            out.push({ text: REPEAT, syllables, vietji: syllables.length ? syllables.map((x) => x.vietji).join('-') : null, wordStart: true })
            continue
        }
        const entry = w.known ? words?.get(w.text) : undefined
        const units = (entry ? listedUnits(w.text, entry) : null) ?? ruleUnits(w.text)
        units.forEach((u, k) => out.push({ ...u, wordStart: k === 0 }))
        prev = units
    }
    return out
}

/** A stretch of Thai read by the spelling rules alone. */
function ruleUnits(run: string): ThaiUnit[] {
    const pieces = parseRun(run)
    const units: ThaiUnit[] = []
    let carry: { text: string; syls: Syl[] } | null = null
    let prevCls: ThaiClass | null = null
    let prevUnwrittenA = false
    for (const piece of pieces) {
        if (piece.text === REPEAT) {
            if (carry) { units.push(toUnit(carry.text, carry.syls)); carry = null }
            const before = units[units.length - 1]
            units.push({ text: REPEAT, syllables: before ? before.syllables : [], vietji: before?.vietji ?? null })
            continue
        }
        const syls: Syl[] = []
        for (const syl of piece.syls) {
            // a sonorant after an unwritten-a high or mid consonant is read in that consonant's class (ขนม, สวัสดี, อร่อย)
            const cls = prevUnwrittenA && prevCls !== 'low' && syl.single ? prevCls! : syl.cls
            syls.push({ ...syl, cls })
            prevUnwrittenA = syl.unwritten === 'a'
            prevCls = syl.cls
        }
        if (!syls.length) {                                                   // a stray mark: shown, not read
            if (carry) { units.push(toUnit(carry.text, carry.syls)); carry = null }
            units.push({ text: piece.text, syllables: [], vietji: null })
            continue
        }
        const text = (carry?.text ?? '') + piece.text
        const all = [...(carry?.syls ?? []), ...syls]
        carry = null
        const lastSyl = all[all.length - 1]
        if (lastSyl.unwritten === 'a' && all.length === 1 && piece !== pieces[pieces.length - 1]) { carry = { text, syls: all }; continue }
        units.push(toUnit(text, all))
    }
    if (carry) units.push(toUnit(carry.text, carry.syls))
    return units
}

// short vowels said long in everyday speech (น้ำ is náam): spelling rules cannot tell, so they are listed
const SAID_LONG = new Set(['น้ำ', 'ได้', 'ไม้', 'ใต้', 'เก้า', 'เช้า', 'เจ้า', 'เท้า'])

function toUnit(text: string, syls: Syl[], byRule = true): ThaiUnit {
    if (byRule && SAID_LONG.has(text)) syls = syls.map((syl) => ({ ...syl, long: true }))
    const syllables = syls.map((syl) => {
        const tone = toneOf(syl, syl.cls)
        return { vietji: spell(syl, tone), tone, vowel: syl.vowel, coda: syl.coda, long: syl.long }
    })
    return { text, syllables, vietji: syllables.length ? syllables.map((x) => x.vietji).join('-') : null }
}

/** Thai text → Việt-ji, every syllable joined by "-" ("สวัสดีครับ" → "xạ-oặt-đi-khrắp"); null when it has no Thai. */
export function thaiToVietji(text: string): string | null {
    const out: string[] = []
    for (const m of (text ?? '').matchAll(THAI_RUN)) {
        for (const u of thaiUnits(m[0])) if (u.vietji) out.push(u.vietji)
    }
    return out.length ? out.join('-') : null
}
