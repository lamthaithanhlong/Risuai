import { describe, expect, it } from 'vitest'
import { composeSuggestions, dictSuggestions, foldVietnamese, loadWordList, makeAsker, needsModel, segment, toneless, vietnameseTail, type WordList } from './vietjiDict'
import { suggest, suggestionPool } from './vietjiSuggest'

const words: WordList = {
    'có': ['avoir', 'il y a', 'oui'], 'tôi': ['je', 'moi'], 'đói': ['avoir faim'], 'muốn': ['vouloir'], 'uống': ['boire'],
    'nước': ['eau'], 'bao nhiêu': ['combien'], 'bao': ['sac'], 'nhiêu': ['beaucoup'],
}

describe('the offline word list', () => {
    it('cuts the typed Vietnamese into the longest known words', () => {
        expect(segment('bao nhiêu', words).map((p) => p.vi)).toEqual(['bao nhiêu'])
        expect(segment('Tôi muốn uống nước!', words).map((p) => p.vi)).toEqual(['tôi', 'muốn', 'uống', 'nước'])
        expect(segment('tôi xyz đói', words).map((p) => p.vi)).toEqual(['tôi', 'đói'])   // an unknown syllable is skipped
    })
    it('one word: each meaning, Vietnamese on top and a reading', () => {
        const s = dictSuggestions('có', words, 'fr')
        expect(s.map((x) => x.text)).toEqual(['avoir', 'il y a', 'oui'])
        expect(s.every((x) => x.meaning === 'có' && x.source === 'dict' && x.vietji)).toBe(true)
        expect(s[2].vietji).toBe('uy')
    })
    it('several words: the words in order, then each alone', () => {
        const s = dictSuggestions('tôi đói', words, 'fr')
        expect(s[0]).toMatchObject({ text: 'je avoir faim', meaning: 'tôi đói · từng chữ' })
        expect(s.slice(1).map((x) => x.text)).toEqual(['je', 'avoir faim'])
    })
    it('no list (another language, or not loaded): nothing', () => {
        expect(dictSuggestions('có', null, 'ja')).toEqual([])
    })
    it('the bar shows the list first when Vietnamese is typed', () => {
        const pool = suggestionPool({ lang: 'fr', dict: dictSuggestions('có', words, 'fr') })
        expect(suggest('có', pool).map((x) => x.text)).toEqual(['avoir', 'il y a', 'oui'])
    })
    it('a word the list does not know does not hide what it does know', () => {
        const pool = suggestionPool({ lang: 'fr', dict: dictSuggestions('tôi rất đói', words, 'fr') })
        expect(suggest('tôi rất đói', pool)[0].text).toBe('je avoir faim')
    })
    it('is fetched once, only for a language that has one, and a failed fetch is tried again', async () => {
        const calls: string[] = []
        let ok = false
        const f = (async (url: string) => { calls.push(url); return ok ? { ok: true, json: async () => ({ words }) } : Promise.reject(new Error('offline')) }) as any
        expect(await loadWordList('ru' as any, f)).toBe(null)                // no list for that language: not even fetched
        expect(await loadWordList('fr', f)).toBe(null)
        ok = true
        expect((await loadWordList('fr', f))?.words['có']).toEqual(['avoir', 'il y a', 'oui'])
        await loadWordList('fr', f)
        expect(calls).toEqual(['/dict/vi-fr.json', '/dict/vi-fr.json'])
    })
    it('asks the model only for what the list does not have or only guessed', () => {
        const dict = { words, unsure: new Set(['nước']) }
        expect(needsModel('tôi đói', dict)).toBe(false)
        expect(needsModel('tôi uống nước', dict)).toBe(true)             // one guessed word is enough
        expect(needsModel('xyz', dict)).toBe(true)                       // nothing known
        expect(needsModel('có', null)).toBe(true)                        // no list
        expect(needsModel('tôi xyz đói', dict)).toBe(true)               // a word the list lacks is not dropped silently
        expect(needsModel('Tôi đói!', dict)).toBe(false)                 // case and punctuation are not words
    })
    it('what the model answered goes before a guess from the list', () => {
        const pool = suggestionPool({ lang: 'fr', dict: dictSuggestions('có', words, 'fr'), asked: [{ text: '«Oui»', vietji: 'uy', meaning: 'Có' }] })
        expect(suggest('có', pool)[0].text).toBe('«Oui»')
    })
})

describe('the built lists (public/dict/vi-*.json)', async () => {
    const { readFileSync } = await import('fs')
    const list = (l: string) => JSON.parse(readFileSync(`public/dict/vi-${l}.json`, 'utf8'))
    const real: WordList = list('fr').words
    it.each([
        ['ja', 'uống', '飲む'], ['ja', 'nước', '水'], ['ja', 'tôi', '私'], ['ja', 'cá', '魚'],
        ['zh', 'uống', '喝'], ['zh', 'nước', '水'], ['zh', 'tôi', '我'], ['zh', 'cá', '鱼'],
        ['ko', 'uống', '마시다'], ['ko', 'nước', '물'], ['ko', 'tôi', '저'], ['ko', 'có', '있다'],
        ['es', 'uống', 'beber'], ['es', 'nước', 'agua'], ['es', 'tôi', 'yo'], ['es', 'cá', 'pescado'],
    ])('%s: %s → %s first', (l, vi, want) => expect(list(l).words[vi]?.[0]?.replace(/\[[^\]]*\]/g, '')).toBe(want))
    it.each(['ja', 'zh', 'ko', 'es'])('%s: every word has a reading in the bar, and "unsure" lists only words of the list', (l) => {
        const d = list(l)
        const sample = Object.keys(d.words).filter((_, i) => i % 400 === 0)
        for (const vi of sample) expect(dictSuggestions(vi, d.words, l as any).length, `${l} ${vi}`).toBeGreaterThan(0)
        expect(d.unsure.every((w: string) => w in d.words)).toBe(true)
    })
    it.each(['fr', 'ja', 'zh', 'ko', 'es'])('%s stays under 2 MB', (l) => {
        expect(readFileSync(`public/dict/vi-${l}.json`).length).toBeLessThan(2_000_000)
    })
    it.each([
        ['có', 'avoir'], ['tôi', 'je'], ['không', 'non'], ['bao nhiêu', 'combien'], ['cảm ơn', 'merci'], ['đói', 'avoir faim'],
        ['uống', 'boire'], ['nước', 'eau'], ['ở đâu', 'où'], ['xin chào', 'bonjour'],
    ])('%s → %s first', (vi, fr) => expect(real[vi]?.[0]).toBe(fr))
})

describe('asking the model (docs/specs/VietjiBar.tla)', () => {
    it('a request still out is shared: typing away and back does not ask again', async () => {
        let calls = 0, release!: (v: string) => void
        const asker = makeAsker((k: string) => { calls++; return new Promise<string>((r) => { release = r }) })
        const a1 = asker.ask('fr|có')
        expect(asker.pending('fr|có')).toBe(true)
        const a2 = asker.ask('fr|có')                                // back to the same text while it is out
        release('oui')
        expect(await a1).toBe('oui'); expect(await a2).toBe('oui')
        expect(calls).toBe(1)
        expect(asker.cached('fr|có')).toBe('oui')
        await asker.ask('fr|có'); expect(calls).toBe(1)              // answered: kept
    })
    it('a failed request is forgotten, so the next pause asks again', async () => {
        let calls = 0
        const asker = makeAsker(async () => { calls++; if (calls === 1) throw new Error('down'); return 'ok' })
        await expect(asker.ask('k')).rejects.toThrow('down')
        expect(asker.pending('k')).toBe(false)
        expect(await asker.ask('k')).toBe('ok')
        expect(calls).toBe(2)
    })
})

describe('typed without marks (the bug: "tui" in Chinese showed nothing)', () => {
    // the object's own order differs from the everyday order on purpose; "ăn" alone is a word too (longest match must win)
    const zh = { words: { 'tủi': ['委屈[wěiqu]'], 'túi': ['袋[dài]'], 'tụi': ['他们[tāmen]'], 'tui': ['我[wǒ]'], 'ăn': ['吃[chī]'], 'ăn cơm': ['吃饭[chīfàn]'], 'đói': ['饿[è]'] } as WordList,
        unsure: new Set<string>(), order: ['tui', 'ăn cơm', 'túi', 'tụi', 'đói'] }
    it('folds marks away, spaces kept', () => {
        expect(foldVietnamese('Túi đỏ!')).toBe('tui do')
        expect(foldVietnamese('ĂN CƠM')).toBe('an com')
    })
    it('"tui": every word it could be, the most used first, Vietnamese with marks on top', () => {
        const s = toneless('tui', zh, 'zh')
        expect(s.map((x) => x.meaning)).toEqual(['tui', 'túi', 'tụi', 'tủi'])     // tủi is not in the order: last
        expect(s[0]).toMatchObject({ text: '我[wǒ]', source: 'dict' })
        expect(s[0].vietji).toBeTruthy()
    })
    it('a toneless sentence: the most used reading of each word, in order', () => {
        const s = toneless('tui an com', zh, 'zh')
        expect(s[0]).toMatchObject({ text: '我[wǒ] 吃饭[chīfàn]', meaning: 'tui ăn cơm · từng chữ' })
        // each word alone too, and the bar keeps them although their meaning is only part of what was typed
        expect(suggest('tui an com', suggestionPool({ lang: 'zh', dict: s })).map((x) => x.text)).toContain('吃饭[chīfàn]')
    })
    it('in the bar: sound matches first ("ni hao"), the toneless word after, and "tui" is no longer empty', () => {
        const pool = suggestionPool({ lang: 'zh', dict: toneless('tui', zh, 'zh') })
        expect(suggest('tui', pool)[0].text).toBe('我[wǒ]')
        const hello = suggestionPool({ lang: 'zh', dict: toneless('ni hao', zh, 'zh') })
        expect(suggest('ni hao', hello)[0].text).toBe('你好[nǐhǎo]')
    })
    it('no list, or nothing it knows: nothing', () => {
        expect(toneless('tui', null, 'zh')).toEqual([])
        expect(toneless('xyzzy', zh, 'zh')).toEqual([])
    })
})

describe('building a sentence word by word from Vietnamese (reported: picking 该 for "我 nên" removed 我)', () => {
    const zh = { words: { 'nên': ['该[gāi]', '变成[biànchéng]'], 'cô ấy': ['她[tā]'], 'hơi': ['有点[yǒudiǎn]'], 'ngốc': ['傻[shǎ]'], 'nghĩ': ['想[xiǎng]'] } as WordList, unsure: new Set<string>() }
    it('only the Vietnamese at the end is replaced, and Chinese joins without a space', () => {
        const chips = composeSuggestions('我 nên', zh, 'zh')
        expect(chips[0]).toMatchObject({ text: '该', replace: '我该' })
        expect(chips.map((c) => c.replace)).toContain('我变成')
    })
    it('a run of Vietnamese words: the whole run word by word, then the first word with the rest left to go on with', () => {
        const chips = composeSuggestions('我 想 cô ấy hơi ngốc', zh, 'zh')
        expect(chips[0]).toMatchObject({ text: '她有点傻', replace: '我 想她有点傻' })          // the learner's own spaces stay
        expect(chips[0].vietji).toBeTruthy()                                               // read from 她[tā] 有点[yǒudiǎn] 傻[shǎ]
        expect(chips.find((c) => c.text === '她')?.replace).toBe('我 想她 hơi ngốc')
    })
    it('Spanish: the foreign words before are kept, with spaces', () => {
        const es = { words: { 'cô ấy': ['ella'], 'nghĩ': ['pensar'] } as WordList, unsure: new Set<string>() }
        expect(vietnameseTail('yo pienso cô ấy', new Set(Object.keys(es.words)))).toEqual({ head: 'yo pienso ', tail: 'cô ấy' })
        expect(composeSuggestions('yo pienso cô ấy', es, 'es')[0].replace).toBe('yo pienso ella')
    })
    it('a Vietnamese word typed right after the characters, with no space, is found (逆该冷静lại)', () => {
        expect(vietnameseTail('逆该冷静lại', new Set(['lại']))).toEqual({ head: '逆该冷静', tail: 'lại' })
        const chips = composeSuggestions('我该冷静lại', { words: { 'lại': ['来[lái]'] }, unsure: new Set<string>() }, 'zh')
        expect(chips[0].replace).toBe('我该冷静来')
    })
    it('nothing to compose when the input is all Vietnamese, or ends in the language', () => {
        expect(vietnameseTail('cô ấy nên', new Set(['nên'])).head).toBe('')
        expect(composeSuggestions('我 想', zh, 'zh')).toEqual([])
    })
})

describe('Vietnamese pronouns (reported: "cô" gave 我; es "i", fr "sourcils" for mày)', () => {
    const list = (l: string) => JSON.parse(require('fs').readFileSync(`public/dict/vi-${l}.json`, 'utf8')).words as WordList
    const bare = (t?: string) => (t ?? '').replace(/\[[^\]]*\]/g, '')
    it.each([
        ['zh', { 'cô': '你', 'chị': '你', 'anh': '你', 'ông': '您', 'mình': '我', 'cô ấy': '她', 'tao': '我' }],
        // あなた is avoided in ordinary sentences (owner, 2026-10-15): そちら, and in a sentence the addressee is left out
        ['ja', { 'cô': 'そちら', 'anh': 'そちら', 'mình': '私', 'cô ấy': '彼女', 'mày': 'お前' }],
        // 당신 sounds cold or rude to someone's face (owner, 2026-10-15): 그쪽, and in a sentence the addressee is left out
        ['ko', { 'cô': '그쪽', 'chị': '그쪽', 'em': '너', 'mình': '나', 'cô ấy': '그녀' }],
        ['es', { 'cô': 'usted', 'chị': 'tú', 'mình': 'yo', 'mày': 'tú', 'cô ấy': 'ella' }],
        ['fr', { 'cô': 'vous', 'mày': 'tu', 'tớ': 'je', 'mình': 'je', 'cô ấy': 'elle' }],
    ] as [string, Record<string, string>][])('%s: spoken to, a kin word is "you"; with ấy, the third person', (l, want) => {
        const w = list(l)
        for (const [vi, first] of Object.entries(want)) expect(bare(w[vi]?.[0]), `${l} ${vi}`).toBe(first)
    })
    it.each(['es', 'fr'])('%s: no English "i" left as a translation', (l) => {
        const w = list(l)
        expect(Object.entries(w).filter(([, picks]) => picks.includes('i')).map(([vi]) => vi)).toEqual([])
    })
})

describe('reported: "thế cái đó là cái quái gì vậy" became 그렇게 개 거기 이다 개 이상하다뭐 그렇다 (cái = dog, đó = there)', () => {
    const list = (l: string) => JSON.parse(require('fs').readFileSync(`public/dict/vi-${l}.json`, 'utf8')).words as WordList
    it('the sentence is read in Vietnamese phrases, in every language', () => {
        const parts = segment('thế cái đó là cái quái gì vậy', list('ko')).map((p) => p.vi)
        expect(parts).toEqual(['thế', 'cái đó', 'là', 'cái quái gì', 'vậy'])
        const first = (l: string) => segment('thế cái đó là cái quái gì vậy', list(l)).map((p) => p.fr[0])
        expect(first('ko')).toEqual(['그럼', '그거', '이다', '도대체 뭐', '그럼'])
        expect(first('zh')).toContain('那个[nàge]')
        expect(first('ja')).toContain('一体何[いったいなに]')
        expect(first('es')).toContain('qué demonios')
        expect(first('fr')).toContain('ça')
    })
    it('cái alone is a thing, never a dog', () => {
        expect(list('ko')['cái'][0]).toBe('것')
        expect(list('fr')['cái'][0]).not.toBe('femelle')
    })
})
