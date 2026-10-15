// Việt-ji for Korean, Chinese and Spanish: the reading of a word in Vietnamese letters, by rule.
//
// Korean: hangul spells sound, so each syllable block is split into its letters and each letter has a Vietnamese spelling
//   (안녕하세요 → an-niơng-ha-sê-dô). Y-sounds at the start of a syllable are written d, as in the Japanese table (や = da).
// Chinese: the model writes pinyin with each word (汉字[hànzì]); each pinyin syllable has a Vietnamese spelling, and its tone
//   becomes a Vietnamese tone mark (1 ngang, 2 sắc, 3 hỏi, 4 huyền, 5 ngang): nǐ hǎo → nỉ hảo.
// Spanish: the spelling is regular, so letters map to Vietnamese ones and a word-final s/z/d closes the syllable with t, the way
//   "dangerous" reads "đang giơ rệt": gracias → gra-xi-át... without tone marks: gra-xi-at.
// These are approximations for a beginner to read aloud, not phonetics.

// ---- Vietnamese tone marks ---------------------------------------------------------------------------------------------------

const TONED: Record<string, string[]> = {
    // vowel: [sắc, huyền, hỏi, ngã, nặng]
    a: ['á', 'à', 'ả', 'ã', 'ạ'], ă: ['ắ', 'ằ', 'ẳ', 'ẵ', 'ặ'], â: ['ấ', 'ầ', 'ẩ', 'ẫ', 'ậ'],
    e: ['é', 'è', 'ẻ', 'ẽ', 'ẹ'], ê: ['ế', 'ề', 'ể', 'ễ', 'ệ'], i: ['í', 'ì', 'ỉ', 'ĩ', 'ị'],
    o: ['ó', 'ò', 'ỏ', 'õ', 'ọ'], ô: ['ố', 'ồ', 'ổ', 'ỗ', 'ộ'], ơ: ['ớ', 'ờ', 'ở', 'ỡ', 'ợ'],
    u: ['ú', 'ù', 'ủ', 'ũ', 'ụ'], ư: ['ứ', 'ừ', 'ử', 'ữ', 'ự'], y: ['ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ'],
}
const MARK_INDEX = { sac: 0, huyen: 1, hoi: 2, nga: 3, nang: 4 } as const
export type VietTone = keyof typeof MARK_INDEX | 'ngang'

/** Puts a tone mark on a Vietnamese syllable: on ơ/ê/ô/â/ă/ư first, else on the second of two vowels when a consonant ends the
 *  syllable or the pair is oa/oe/uy, else on the first of the vowels. */
export function toneSyllable(syl: string, tone: VietTone): string {
    if (tone === 'ngang') return syl
    const chars = [...syl]
    const vowelIdx = chars.map((c, i) => (TONED[c] ? i : -1)).filter((i) => i >= 0)
    if (vowelIdx.length === 0) return syl
    let at = vowelIdx.find((i) => 'ơêôâăư'.includes(chars[i]))
    if (at === undefined) {
        const last = vowelIdx[vowelIdx.length - 1]
        const endsWithConsonant = last < chars.length - 1
        const pair = vowelIdx.length >= 2 ? chars[vowelIdx[vowelIdx.length - 2]] + chars[last] : ''
        at = vowelIdx.length === 1 ? vowelIdx[0]
            : endsWithConsonant || ['oa', 'oe', 'uy', 'ue'].includes(pair) ? last
            : vowelIdx[vowelIdx.length - 2]
    }
    chars[at] = TONED[chars[at]][MARK_INDEX[tone]]
    return chars.join('')
}

// ---- Korean ------------------------------------------------------------------------------------------------------------------

const KO_INITIAL = ['k', 'k', 'n', 'đ', 't', 'r', 'm', 'b', 'p', 's', 's', '', 'ch', 'ch', 'ch', 'kh', 'th', 'p', 'h']
const KO_VOWEL = ['a', 'e', 'ia', 'ie', 'ơ', 'ê', 'iơ', 'iê', 'ô', 'oa', 'oe', 'uê', 'iô', 'u', 'uơ', 'uê', 'uy', 'iu', 'ư', 'ưi', 'i']
// 28 finals (0 = none) reduced to the seven sounds Korean actually ends a syllable with
const KO_FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']

function koSyllableStart(initial: string, vowel: string): string {
    if (initial === 'k') return (/^[eêi]/.test(vowel) ? 'k' : 'c') + vowel     // Vietnamese writes k only before e ê i
    if (initial === '' && vowel.startsWith('i') && vowel.length > 1) return 'd' + vowel.slice(1)   // 요 → dô (y = d, as や = da)
    return initial + vowel
}

// Liaison (연음): a final consonant before a syllable that starts with the silent ㅇ is said at the start of that syllable
// (한국어 → han-gu-gơ, 읽어요 → il-gơ-dô). Per final: [what stays, what moves]; ㅇ never moves, ㅎ is dropped.
const KO_LIAISON: [string, string][] = [
    ['', ''], ['', 'g'], ['', 'c'], ['c', 's'], ['', 'n'], ['n', 'ch'], ['', 'n'], ['', 'đ'], ['', 'r'], ['l', 'g'], ['l', 'm'],
    ['l', 'b'], ['l', 's'], ['l', 'th'], ['l', 'p'], ['', 'r'], ['', 'm'], ['', 'b'], ['p', 's'], ['', 's'], ['', 's'], ['ng', ''],
    ['', 'ch'], ['', 'ch'], ['', 'kh'], ['', 'th'], ['', 'p'], ['', ''],
]
const SILENT_IEUNG = 11

/** One hangul word → Việt-ji ("안녕하세요" → "an-niơng-ha-sê-dô"); null when it holds no hangul syllable. */
export function hangulToVietji(word: string): string | null {
    const blocks = [...word].filter((c) => { const cp = c.codePointAt(0)!; return cp >= 0xAC00 && cp <= 0xD7A3 })
    if (blocks.length === 0) return null
    const parts = blocks.map((c) => {
        const n = c.codePointAt(0)! - 0xAC00
        return { i: Math.floor(n / 588), v: Math.floor((n % 588) / 28), f: n % 28 }
    })
    const out: string[] = []
    let carried = ''                                                    // a consonant moved here from the syllable before
    for (let k = 0; k < parts.length; k++) {
        const { i, v, f } = parts[k]
        const vowel = KO_VOWEL[v]
        let syl: string
        if (carried) {
            const onset = carried === 'g' && /^[eêi]/.test(vowel) ? 'gh' : carried === 'c' && /^[eêi]/.test(vowel) ? 'k' : carried
            syl = onset + vowel
        } else if (i === 0 && k > 0 && [0, 4, 8, 16, 21].includes(parts[k - 1].f)) {
            syl = (/^[eêi]/.test(vowel) ? 'gh' : 'g') + vowel                 // ㄱ between voiced sounds is said g: 한국 → han-guc
        } else {
            syl = koSyllableStart(KO_INITIAL[i], vowel)
        }
        carried = ''
        const next = parts[k + 1]
        let fin = KO_FINAL[f]
        if (f && next && next.i === SILENT_IEUNG && f !== 21) {
            [fin, carried] = KO_LIAISON[f]
        } else if (fin && next && (next.i === 2 || next.i === 6)) {     // a stop before ㄴ/ㅁ is said nasal: 합니다 → ham-ni-đa
            fin = fin === 'p' ? 'm' : fin === 'k' ? 'ng' : fin === 't' ? 'n' : fin
        }
        if (fin === 'k') fin = 'c'                                      // Vietnamese ends a syllable with c, not k
        out.push(syl + fin)
    }
    return out.join('-')
}

// ---- Chinese (pinyin) --------------------------------------------------------------------------------------------------------

const PY_INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w']
const PY_INITIAL_VI: Record<string, string> = {
    b: 'p', p: 'p', m: 'm', f: 'ph', d: 't', t: 'th', n: 'n', l: 'l', g: 'c', k: 'kh', h: 'h',
    j: 'ch', q: 'ch', x: 'x', zh: 'tr', ch: 'tr', sh: 's', r: 'r', z: 'ch', c: 'ts', s: 'x', y: '', w: '',
}
const PY_FINAL_VI: Record<string, string> = {
    a: 'a', o: 'ua', e: 'ưa', i: 'i', u: 'u', ü: 'uy', v: 'uy', ai: 'ai', ei: 'ây', ao: 'ao', ou: 'âu', an: 'an', en: 'ân',
    ang: 'ang', eng: 'âng', ong: 'ung', er: 'ơ', ia: 'ia', ie: 'iê', iao: 'iao', iu: 'iêu', iou: 'iêu', ian: 'iên', in: 'in',
    iang: 'iang', ing: 'inh', iong: 'iung', ua: 'oa', uo: 'ua', uai: 'oai', ui: 'uây', uei: 'uây', uan: 'oan', un: 'uân',
    uen: 'uân', uang: 'oang', ueng: 'uâng', üe: 'uê', ve: 'uê', üan: 'oen', van: 'oen', ün: 'uyn', vn: 'uyn',
}
const PY_TONE_MARKS: Record<string, [string, number]> = {}
for (const [base, marks] of Object.entries({ a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' })) {
    [...marks].forEach((m, i) => { PY_TONE_MARKS[m] = [base, i + 1] })
}
const PY_TO_VIET_TONE: Record<number, VietTone> = { 1: 'ngang', 2: 'sac', 3: 'hoi', 4: 'huyen', 5: 'ngang' }

/** One pinyin syllable (tone marks or a trailing digit) → Vietnamese letters with a tone mark; null when it is not pinyin. */
export function pinyinSyllableToVietji(syl: string): string | null {
    let tone = 5
    let plain = ''
    for (const ch of syl.toLowerCase()) {
        if (PY_TONE_MARKS[ch]) { plain += PY_TONE_MARKS[ch][0]; tone = PY_TONE_MARKS[ch][1] } else plain += ch
    }
    const digit = /([1-5])$/.exec(plain)
    if (digit) { tone = Number(digit[1]); plain = plain.slice(0, -1) }
    const initial = PY_INITIALS.find((i) => plain.startsWith(i)) ?? ''
    let final = plain.slice(initial.length)
    if (initial === 'y') final = final === 'u' || final.startsWith('u') ? 'ü' + final.slice(1) : final.startsWith('i') ? final : 'i' + final
    if (initial === 'w') final = final === 'u' ? 'u' : 'u' + final
    if ('jqx'.includes(initial) && final.startsWith('u')) final = 'ü' + final.slice(1)
    if (['z', 'c', 's', 'zh', 'ch', 'sh', 'r'].includes(initial) && final === 'i') final = 'ư'
    const fin = final === 'ư' ? 'ư' : PY_FINAL_VI[final]
    if (fin === undefined || (initial === '' && plain === '')) return null
    let vi = (PY_INITIAL_VI[initial] ?? '') + fin
    if (vi.startsWith('c') && /^c[eêi]/.test(vi)) vi = 'k' + vi.slice(1)
    // y- syllables: a glide i becomes d (yao → dao, you → dêu) as や = da; yi/yin/ying stay i; yu- (ü) takes d too (yuè → duề)
    if (initial === 'y' && vi.startsWith('i') && vi.length > 1 && vi !== 'in' && vi !== 'inh') vi = 'd' + vi.slice(1)
    else if (initial === 'y' && /^(uy|uê|oen)/.test(vi)) vi = 'd' + vi
    return toneSyllable(vi, PY_TO_VIET_TONE[tone])
}

/** Pinyin for a word ("nǐhǎo", "ni3 hao3", "Běijīng") → Việt-ji ("nỉ-hảo"); null when a syllable cannot be read. */
export function pinyinToVietji(pinyin: string): string | null {
    const syllables = splitPinyin(pinyin)
    if (!syllables.length) return null
    const out: string[] = []
    for (const s of syllables) {
        const v = pinyinSyllableToVietji(s)
        if (v === null) return null
        out.push(v)
    }
    return out.join('-')
}

/** Splits run-together pinyin ("nǐhǎo") into syllables, longest match first, apostrophes and spaces kept as breaks. */
export function splitPinyin(text: string): string[] {
    const out: string[] = []
    for (const chunk of text.trim().split(/[\s'’\-]+/).filter(Boolean)) {
        let rest = chunk
        while (rest) {
            let hit = ''
            for (let len = Math.min(7, rest.length); len >= 1; len--) {
                const piece = rest.slice(0, len)
                // a syllable must not swallow the initial of the next one ("xian" vs "xi'an" aside, prefer the longer reading)
                if (pinyinSyllableToVietji(piece) !== null) { hit = piece; break }
            }
            if (!hit) return []
            out.push(hit)
            rest = rest.slice(hit.length)
        }
    }
    return out
}

// ---- Spanish ----------------------------------------------------------------------------------------------------------------

const ES_VOWELS = 'aeiouáéíóúü'
const ES_PLAIN: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' }

/** One Spanish word → Việt-ji ("gracias" → "gra-xi-at", "señor" → "xê-nhor"); null when it has no letter. */
export function spanishToVietji(word: string): string | null {
    const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, '')
    if (!w) return null
    // letters → sound units
    const units: string[] = []
    for (let i = 0; i < w.length; i++) {
        const c = w[i], n = w[i + 1] ?? '', n2 = w[i + 2] ?? ''
        const front = 'eéií'.includes(n)
        if (c === 'c' && n === 'h') { units.push('ch'); i++; continue }
        if (c === 'l' && n === 'l') { units.push('d'); i++; continue }
        if (c === 'r' && n === 'r') { units.push('r'); i++; continue }
        if (c === 'q' && n === 'u') { units.push('k'); i++; continue }
        if (c === 'g' && n === 'u' && 'eéií'.includes(n2)) { units.push('gh'); i++; continue }
        if (c === 'g') { units.push(front ? 'kh' : 'g'); continue }
        if (c === 'c') { units.push(front ? 'x' : 'c'); continue }
        if (c === 'z') { units.push('x'); continue }
        if (c === 's') { units.push('x'); continue }
        if (c === 'j') { units.push('kh'); continue }
        if (c === 'h') continue
        if (c === 'ñ') { units.push('nh'); continue }
        if (c === 'v' || c === 'b') { units.push('b'); continue }
        if (c === 'd') { units.push('đ'); continue }
        if (c === 'f') { units.push('ph'); continue }
        if (c === 'y') { units.push(ES_VOWELS.includes(n) && n ? 'd' : 'i'); continue }
        if (c === 'x') { units.push('x'); continue }
        units.push(ES_PLAIN[c] ?? c)
    }
    // group into syllables: an onset (with an r/l cluster) before each vowel group, one coda consonant at most
    const isV = (u: string) => 'aeiou'.includes(u)
    const hasV = (t: string) => /[aeiou]/.test(t)
    const cluster = (a: string, b: string | undefined) => !!b && 'rl'.includes(b) && ['b', 'c', 'đ', 'ph', 'g', 'k', 'p', 't'].includes(a)
    const syll: string[] = []
    let cur = ''
    for (let i = 0; i < units.length; i++) {
        const u = units[i], next = units[i + 1]
        if (isV(u)) {
            if (cur && hasV(cur) && !isV(cur[cur.length - 1])) { syll.push(cur); cur = '' }   // after a coda: new syllable
            cur += u
            // strong vowels (a e o) stay apart: le-ó-n; an i before another vowel is its own syllable for a Vietnamese reader:
            // gracias → gra-xi-at, días → đi-at
            if (next && isV(next) && (('aeo'.includes(u) && 'aeo'.includes(next)) || u === 'i')) { syll.push(cur); cur = '' }
            continue
        }
        if (!hasV(cur)) { cur += u; continue }                                   // onset, clusters included
        if (!isV(cur[cur.length - 1])) { syll.push(cur); cur = u; continue }     // a coda is already there
        if (next === undefined) { cur += u; continue }                           // word-final coda
        if (isV(next) || cluster(u, next)) { syll.push(cur); cur = u; continue } // starts the next syllable
        cur += u                                                                 // coda before another consonant
    }
    if (cur) syll.push(cur)
    // Vietnamese spelling of each syllable
    return syll.map((s, i) => {
        let v = s.replace(/e/g, 'ê').replace(/o/g, 'ô')
        if (i === syll.length - 1) v = v.replace(/(x|đ)$/, 't')                    // final s/z/d close with t: días → đi-at
        else v = v.replace(/x$/, 't')
        v = v.replace(/^c(?=[êi])/, 'k')
        return v
    }).join('-')
}
