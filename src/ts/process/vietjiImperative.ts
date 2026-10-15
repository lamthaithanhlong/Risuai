// Vietnamese "đi" at the end of a sentence, after a verb, is the imperative ("bình tĩnh đi" = calm down!, "ngồi đi" = sit),
// not the verb "go" (asked 2026-10-15: "sửa luôn đuôi đi thành mệnh lệnh"). Word by word it gave 침착하다 가다. This turns the
// verb before it into the language's own imperative, regular forms only: an irregular verb (듣다, 돕다, 帰る…) may come out
// wrong, and the check after sending corrects it.
//
// Words come in the list's own form: Chinese and Japanese carry their reading in brackets (冷静[lěngjìng], 落ち着く[おちつく]).

import type { LearningLang } from './vietji'

/** Vietnamese words that, after a verb at the end of a sentence, make it an order or an urging. */
export const IMPERATIVE_VI = new Set(['đi', 'đi nào', 'đi mà'])
/** After a person, đi is the verb: "tôi đi" is I go, not an order. */
export const PERSON_VI = new Set(['tôi', 'tui', 'tao', 'mình', 'ta', 'bạn', 'cậu', 'mày', 'anh', 'chị', 'em', 'cô', 'chú', 'bác', 'ông', 'bà',
    'nó', 'họ', 'hắn', 'chúng tôi', 'chúng ta', 'chúng mình', 'tụi mình', 'cô ấy', 'anh ấy', 'ai'])
const PERSON_ZH = /^(?:我|你|您|他|她|它|我们|你们|他们|她们|咱们|大家)$/

// ---- Korean -------------------------------------------------------------------------------------------------------------------
const H0 = 0xac00
const syl = (c: string) => { const n = c.charCodeAt(0) - H0; return n >= 0 && n < 11172 ? { l: Math.floor(n / 588), v: Math.floor((n % 588) / 28), t: n % 28 } : null }
const make = (l: number, v: number, t: number) => String.fromCharCode(H0 + l * 588 + v * 28 + t)
const V = { a: 0, ae: 1, ya: 2, eo: 4, e: 5, yeo: 6, o: 8, wa: 9, u: 13, wo: 14, eu: 18, i: 20 }
const T_RIEUL = 8
const NOT_ORDERS = new Set(['이다', '아니다', '있다', '없다'])

function koImperative(word: string): string[] {
    if (!/^[가-힣]+다$/.test(word) || word.length < 2 || NOT_ORDERS.has(word)) return []
    const stem = word.slice(0, -1)
    const last = syl(stem.at(-1)!)!
    const before = stem.slice(0, -1)
    // the polite order: stem + (으)세요; a final ㄹ drops (살다 → 사세요)
    const polite = last.t === 0 ? stem + '세요' : last.t === T_RIEUL ? before + make(last.l, last.v, 0) + '세요' : stem + '으세요'
    // the plain one: stem + 아/어, the vowels joined when there is no final consonant
    let plain: string
    if (stem.endsWith('하')) plain = before + '해'
    else if (last.t !== 0) plain = stem + (last.v === V.a || last.v === V.o ? '아' : '어')
    else {
        const join: Record<number, number> = { [V.a]: V.a, [V.o]: V.wa, [V.u]: V.wo, [V.i]: V.yeo, [V.eu]: V.eo, [V.eo]: V.eo, [V.e]: V.e, [V.ae]: V.ae, [V.yeo]: V.yeo }
        const v = join[last.v]
        plain = v === undefined ? stem + '어' : before + make(last.l, v, 0)
    }
    return [polite, plain]
}

// ---- Japanese: the te-form, then ください -----------------------------------------------------------------------------------------
// る after an i/e sound is usually ichidan (食べる → 食べて); these godan ones look the same (帰る → 帰って). いる and きる stay
// ichidan (居る, 着る: the more used readings).
const GODAN_RU = ['かえる', 'はいる', 'はしる', 'しる', 'へる', 'すべる', 'しゃべる', 'かぎる', 'ける', 'あせる', 'まいる', 'にぎる', 'ちる', 'いじる']
const I_E_ROW = /[いきぎしじちぢにひびぴみりえけげせぜてでねへべぺめれ]$/
const TE: Record<string, string> = { う: 'って', つ: 'って', る: 'って', む: 'んで', ぶ: 'んで', ぬ: 'んで', く: 'いて', ぐ: 'いで', す: 'して' }

export function teForm(kana: string): string | null {
    if (kana.endsWith('する')) return kana.slice(0, -2) + 'して'
    if (kana.endsWith('くる') && kana.length === 2) return 'きて'
    if (kana === 'いく' || kana.endsWith('にいく') || kana === 'ゆく') return kana.slice(0, -1) + 'って'
    const stem = kana.slice(0, -1), end = kana.at(-1)!
    const godanRu = GODAN_RU.some((g) => kana === g || (kana.endsWith(g) && g.length >= 3))
    if (end === 'る' && !godanRu && I_E_ROW.test(stem)) return stem + 'て'
    return TE[end] ? stem + TE[end] : null
}

function jaImperative(word: string): string[] {
    const m = /^([^[\]]+)(?:\[([^\]]+)\])?$/.exec(word)
    if (!m) return []
    const surface = m[1], reading = m[2] ?? surface
    if (!/[うくぐすつぬぶむる]$/.test(surface)) return []
    if (surface === '来る') return ['来て[きて]ください', '来て[きて]']
    const te = teForm(reading)
    if (!te) return []
    let p = 0
    while (p < reading.length && reading[p] === te[p]) p++
    const changed = reading.slice(p)                    // the kana at the end that change (る, く, する…)
    if (!changed || !surface.endsWith(changed)) return []
    const s = surface.slice(0, surface.length - changed.length) + te.slice(p)
    const form = s === te ? s : `${s}[${te}]`
    return [form + 'ください', form]
}

// ---- Spanish: tú, then usted --------------------------------------------------------------------------------------------------
const ES_TU: Record<string, string> = { seguir: 'sigue', elegir: 'elige', tener: 'ten', venir: 'ven', poner: 'pon', salir: 'sal', hacer: 'haz', decir: 'di', ir: 've', ser: 'sé' }
// stem-changing verbs: the stressed stem vowel changes (pensar → piensa, dormir → duerme, pedir → pide)
const ES_STEM: Record<string, string> = {
    pensar: 'piens', cerrar: 'cierr', empezar: 'empiez', sentar: 'sient', despertar: 'despiert', entender: 'entiend', perder: 'pierd',
    querer: 'quier', sentir: 'sient', mentir: 'mient', dormir: 'duerm', volver: 'vuelv', contar: 'cuent', mostrar: 'muestr',
    acostar: 'acuest', encontrar: 'encuentr', recordar: 'recuerd', mover: 'muev', jugar: 'jueg', probar: 'prueb', soñar: 'sueñ',
    pedir: 'pid', repetir: 'repit', servir: 'sirv', vestir: 'vist',
}
/** Verbs that are not given as orders: gustar is said of the thing liked (me gusta), not told to someone. */
const ES_NO_ORDER = new Set(['gustar', 'parecer', 'doler', 'importar', 'faltar', 'haber'])
const ES_USTED: Record<string, string> = { seguir: 'siga', elegir: 'elija', tener: 'tenga', venir: 'venga', poner: 'ponga', salir: 'salga', hacer: 'haga', decir: 'diga', ir: 'vaya', ser: 'sea' }
const STRONG: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' }

/** A pronoun put on the end moves the stress back: calma + te → cálmate (the vowel of the stressed syllable gets its mark). */
function accentForClitic(form: string): string {
    const groups = [...form.matchAll(/[aeiouáéíóú]+/g)]
    if (groups.length < 2 || /[áéíóú]/.test(form)) return form
    const g = groups[groups.length - 2]
    const k = g[0].search(/[aeo]/) >= 0 ? g[0].search(/[aeo]/) : g[0].length - 1
    const at = g.index! + k
    return form.slice(0, at) + STRONG[form[at]] + form.slice(at + 1)
}

function esImperative(word: string): string[] {
    const m = /^([a-zñ]*?)(ar|er|ir)(se)?$/.exec(word.toLowerCase())
    if (!m) return []
    const [, plainStem, end, se] = m
    const inf = plainStem + end
    if (ES_NO_ORDER.has(inf)) return []
    const stem = ES_STEM[inf] ?? plainStem
    // -ar keeps its sound before the usted e: buscar → busque, jugar → juegue, empezar → empiece
    const ustedStem = end !== 'ar' ? stem : stem.endsWith('c') ? stem.slice(0, -1) + 'qu' : stem.endsWith('g') ? stem + 'u' : stem.endsWith('z') ? stem.slice(0, -1) + 'c' : stem
    const tu = ES_TU[inf] ?? stem + (end === 'ar' ? 'a' : 'e')
    const usted = ES_USTED[inf] ?? ustedStem + (end === 'ar' ? 'e' : 'a')
    return se ? [accentForClitic(tu) + 'te', accentForClitic(usted) + 'se'] : [tu, usted]
}

// ---- French: tu, then vous ----------------------------------------------------------------------------------------------------
const FR: Record<string, [string, string]> = {
    aller: ['va', 'allez'], être: ['sois', 'soyez'], avoir: ['aie', 'ayez'], faire: ['fais', 'faites'], venir: ['viens', 'venez'],
    partir: ['pars', 'partez'], sortir: ['sors', 'sortez'], dormir: ['dors', 'dormez'], courir: ['cours', 'courez'],
    tenir: ['tiens', 'tenez'], dire: ['dis', 'dites'], prendre: ['prends', 'prenez'], mettre: ['mets', 'mettez'],
    voir: ['vois', 'voyez'], écrire: ['écris', 'écrivez'], lire: ['lis', 'lisez'], asseoir: ['assieds', 'asseyez'], taire: ['tais', 'taisez'],
    appeler: ['appelle', 'appelez'], jeter: ['jette', 'jetez'], boire: ['bois', 'buvez'], croire: ['crois', 'croyez'], conduire: ['conduis', 'conduisez'],
    battre: ['bats', 'battez'], suivre: ['suis', 'suivez'], vivre: ['vis', 'vivez'], ouvrir: ['ouvre', 'ouvrez'], offrir: ['offre', 'offrez'],
    savoir: ['sache', 'sachez'], vouloir: ['veuille', 'veuillez'], devenir: ['deviens', 'devenez'], revenir: ['reviens', 'revenez'],
}
/** e or é before the last consonant opens to è in the tu form: acheter → achète, lever → lève, préférer → préfère. */
const openE = (stem: string) => stem.replace(/[eé]([bcdfghjklmnpqrstvz])$/, 'è$1')
function frImperative(word: string): string[] {
    const m = /^(?:(?:se |s[’'])?)([a-zàâçéèêëîïôûùüÿœ]+)$/.exec(word.toLowerCase())
    if (!m) return []
    const reflexive = /^(se |s[’'])/.test(word.toLowerCase())
    const inf = m[1]
    let forms: [string, string] | null = FR[inf] ?? null
    if (!forms && inf.endsWith('er')) forms = [openE(inf.slice(0, -2)) + 'e', inf.slice(0, -2) + 'ez']
    else if (!forms && inf.endsWith('ir')) forms = [inf.slice(0, -2) + 'is', inf.slice(0, -2) + 'issez']
    // only -dre is a regular -re verb (attendre, répondre): sincère, libre, rouge… end the same way and are not verbs
    else if (!forms && inf.endsWith('dre')) forms = [inf.slice(0, -2) + 's', inf.slice(0, -2) + 'ez']
    if (!forms) return []
    return reflexive ? [`${forms[0]}-toi`, `${forms[1]}-vous`] : forms
}

/** The verb in the list's own form made an order: the polite or usual one first. Not a verb (or unsure): []. */
export function imperative(word: string, lang: LearningLang): string[] {
    const w = (word ?? '').trim()
    if (!w) return []
    if (lang === 'ko') return koImperative(w)
    if (lang === 'ja') return jaImperative(w)
    if (lang === 'es') return esImperative(w)
    if (lang === 'fr') return frImperative(w)
    // Chinese has no verb ending: 吧 after it makes it an urging (冷静吧, 坐吧)
    if (lang === 'zh') return /[\u3400-\u9fff]/.test(w) && !w.includes('吧') && !PERSON_ZH.test(w.replace(/\[[^\]]*\]/g, '')) ? [w + '吧[ba]'] : []
    return []
}
