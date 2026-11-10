// npcCheck.mjs: the ledger fold, the extractor on the owner's live lines (2026-11-05, Zombie, 704 balcony), the Dafny lemmas as
// properties over random cards, the GM-note card and the cut fallback. The Witness cases are in npcCheck.dafny.test.ts (generated).
import { describe, expect, test } from 'vitest'
import fs from 'fs'
import path from 'path'
import { accept, addressPairHits, appendNpcLines, parseInner, cardLine, cutViolations, extractFacts, foldNpc, grammarHits, LOW_TRUST, npcCardsNote, npcHits, npcOpsOf, npcRewriteNote, scrubRegister, stepNpc } from './npcCheck.mjs'

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../tests/acceptance/fixtures/owner-chats/npc-dialogue-704.json'), 'utf8'))
// the balcony woman's ledger as the bookkeeper would write it up to the owner's turn 11 (painkillers pulled over, fever medicine needed)
const LEDGER = [
    '9 | ban-cong-704 | meet Người phụ nữ ban công 704;tôi;anh;30s',
    '9 | ban-cong-704 | need+ thuốc giảm đau',
    '10 | ban-cong-704 | recv thuốc giảm đau',
    '11 | ban-cong-704 | need+ thuốc hạ sốt',
    '11 | ban-cong-704 | need+ rửa vết thương',
    '11 | ban-cong-704 | trust low',
].join('\n')
const P = { player: 'Kenji Park' }
const rules = (hits: { rule: string; soft?: boolean }[]) => hits.filter((h) => !h.soft).map((h) => h.rule)

describe('register scrubbing', () => {
    test('uses player register for blank cards, including an unclosed quote', () => {
        const cards = [...foldNpc('1 | aki | meet Aki\n1 | naru | meet Naru', 2).values()]
        const playerText = 'tui đứng dậy chạy theo họ nói này các cậu hmm cho tớ tham gia câu lạc bộ được ko'
        const reply = 'Đôi chân anh bước đi.\n"Ồ, anh là người mới muốn gia nhập à?"\n"Tuyệt quá! như anh đấy!"\n"Chào anh.'
        expect(scrubRegister(reply, cards, playerText)).toBe('Đôi chân anh bước đi.\n"Ồ, cậu là người mới muốn gia nhập à?"\n"Tuyệt quá! như cậu đấy!"\n"Chào cậu.')
        expect(scrubRegister('của anh. "Chị và bọn tôi."', cards, playerText)).toBe('của anh. "Cậu và bọn tớ."')
        expect(scrubRegister('Tôi thấy anh có vẻ rất nhiệt huyết đấy.”\n“Đúng thế! Tụi mình luôn chào đón thành viên mới mà.”\nĐôi chân anh bước đi.', cards, playerText)).toBe('Tớ thấy cậu có vẻ rất nhiệt huyết đấy.”\n“Đúng thế! Tụi mình luôn chào đón thành viên mới mà.”\nĐôi chân anh bước đi.')
        expect(scrubRegister(reply, cards, 'cậung tớ')).toBe(reply)
        expect(scrubRegister(reply, [], playerText)).toBe(reply)
    })
    test('uses the agreed peer register only inside quotes', () => {
        const ledger = '12 | aki | meet Aki;tớ;cậu;\n12 | naru | meet Naru;tớ;cậu;'
        const cards = [...foldNpc(ledger, 13).values()]
        const reply = 'Đôi chân anh bước đi đầy dứt khoát.\n“Ồ, anh muốn tham gia sao? Tôi cũng thấy anh rất thú vị đấy.”\n“Tuyệt quá! Câu lạc bộ bơi lội đang cần thêm người năng động như anh để hỗ trợ mà!”\n“Chào anh, rất vui được gặp anh. Nếu anh thích bơi lội thì sẽ hợp với bọn tôi lắm đấy.”'
        expect(scrubRegister(reply, cards)).toBe('Đôi chân anh bước đi đầy dứt khoát.\n“Ồ, cậu muốn tham gia sao? Tớ cũng thấy cậu rất thú vị đấy.”\n“Tuyệt quá! Câu lạc bộ bơi lội đang cần thêm người năng động như cậu để hỗ trợ mà!”\n“Chào cậu, rất vui được gặp cậu. Nếu cậu thích bơi lội thì sẽ hợp với bọn tớ lắm đấy.”')
        expect(scrubRegister('“Anh và chị.”', cards)).toBe('“Cậu và cậu.”')
        const clean = 'Aki nói: “Cậu quên hồ sơ à? Tớ thấy trên bàn.”'
        expect(scrubRegister(clean, cards)).toBe(clean)
        const stranger = '“Tôi chưa dám nhận đồ của người lạ, anh cứ giữ thuốc hạ sốt đi.”'
        expect(scrubRegister(stranger, [...foldNpc(LEDGER, 13).values()])).toBe(stranger)
        expect(rules(npcHits('Aki nói: “Anh muốn tham gia sao?”', { ledger, n: 13 }))).toContain('npc-register')
    })
})

describe('ledger', () => {
    test('fold before turn 13: needs fever medicine and something to wash the wound, holds the painkillers she received, low trust', () => {
        const c = foldNpc(LEDGER, 13).get('ban-cong-704')!
        expect([...c.needs].sort()).toEqual(['do_rua_vet_thuong', 'thuoc_ha_sot'])
        expect([...c.has]).toEqual([['thuoc_giam_dau', 1]])
        expect([...c.received]).toEqual(['thuoc_giam_dau'])
        expect(c.trust).toBeLessThan(LOW_TRUST)
    })
    test('the fold reads only replies before n (a regenerated draft is judged on the same state)', () => {
        const c = foldNpc(LEDGER, 11).get('ban-cong-704')!
        expect(c.needs.size).toBe(0)
        expect(c.has.get('thuoc_giam_dau')).toBe(1)
    })
    test('ops that would break Dafny Inv are dropped: has- below 1, a need of an item received', () => {
        const c = foldNpc(LEDGER + '\n12 | ban-cong-704 | has- thuốc giảm đau\n12 | ban-cong-704 | has- thuốc giảm đau\n12 | ban-cong-704 | need+ thuốc giảm đau', 99).get('ban-cong-704')!
        expect(c.has.has('thuoc_giam_dau')).toBe(false)
        expect(c.needs.has('thuoc_giam_dau')).toBe(false)
    })
    test('append: n-keyed, deduped, bad lines refused; the helper\'s npc: lines parse', () => {
        const ops = npcOpsOf(['beat: 3 | x | y\nnpc: Ban công 704 | need+ thuốc hạ sốt\nnpc: ban-cong-704 | fly away\n- npc: ban-cong-704 | trust low'])
        expect(ops).toEqual([{ id: 'Ban công 704', op: 'need+', value: 'thuốc hạ sốt' }, { id: 'ban-cong-704', op: 'trust', value: 'low' }])
        const a = appendNpcLines('', 12, ops)
        expect(a.added).toBe(2)
        expect(appendNpcLines(a.ledger, 12, ops).added).toBe(0)
        expect(a.ledger.split('\n')[0]).toBe('12 | ban-công-704 | need+ thuốc hạ sốt')
    })
})

describe('Dafny lemmas as properties (random cards satisfying Inv)', () => {
    const ITEMS = ['a', 'b', 'c', 'd']
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pick = () => new Set(ITEMS.filter(() => rnd() < 0.3))
    const inv = (s: any) => [...s.needs].every((x: string) => !s.received.has(x)) && [...s.has.values()].every((v: number) => v >= 1) && s.trust >= 0 && s.trust <= 100
    test('AcceptNoNeedRefusal, AcceptTrustedNeverRefusesNeed, AcceptSentenceCap, StepPreservesInv, StepGivenIsHeld over 3000 cases', () => {
        let accepted = 0
        for (let k = 0; k < 3000; k++) {
            const received = pick()
            const s = { isAdmin: rnd() < 0.1, needs: new Set([...pick()].filter((x) => !received.has(x))), has: new Map([...pick()].map((x) => [x, 1 + Math.floor(rnd() * 3)] as [string, number])), trust: Math.floor(rnd() * 101), received }
            const f = { requests: pick(), offers: pick(), refusals: pick(), handed: pick(), questHook: rnd() < 0.2, exposition: rnd() < 0.2, playerAskedWhy: rnd() < 0.5, reasonFlag: rnd() < 0.5, sentences: Math.floor(rnd() * 4), unaddressed: rnd() < 0.2 }
            expect(inv(s)).toBe(true)
            if (accept(s, f).length) continue
            accepted++
            if (!(f.reasonFlag && s.trust < LOW_TRUST)) for (const i of f.refusals) expect(s.needs.has(i)).toBe(false)
            if (s.trust >= LOW_TRUST) for (const i of f.refusals) expect(s.needs.has(i)).toBe(false)
            expect(f.sentences).toBeLessThanOrEqual(2)
            expect(f.unaddressed).toBe(false)
            const given = pick()
            const t = stepNpc(s, f, given, Math.floor(rnd() * 60) - 30)
            expect(inv(t)).toBe(true)
            for (const g of given) { expect(t.has.has(g)).toBe(true); expect(t.needs.has(g)).toBe(false) }
        }
        expect(accepted).toBeGreaterThan(50)
    })
})

describe('extractor and hits on the owner\'s lines', () => {
    test('class 1: “Đừng gọi ai. Tôi bị kính cửa thôi.” is npc-grammar (bị + noun, telegraph); the stored “kính cứa” is not bị+noun', () => {
        expect(grammarHits('Đừng gọi ai. Tôi bị kính cửa thôi.').map((h) => h.why)).toEqual(['bị + noun, no verb', 'telegraph: Đừng gọi ai / Tôi bị kính cửa thôi'])
        expect(grammarHits('Đừng gọi ai. Tôi bị kính cứa thôi.').some((h) => h.why === 'bị + noun, no verb')).toBe(false)
        expect(rules(npcHits(fx.balcony_bad, P))).toContain('npc-grammar')
        expect(rules(npcHits(fx.balcony_good, P))).not.toContain('npc-grammar')
    })
    test('class 1: the gate telegrams are npc-grammar, their rewrites are clean', () => {
        expect(rules(npcHits(fx.telegram_bad, P)).filter((r) => r === 'npc-grammar').length).toBe(3)
        expect(rules(npcHits(fx.telegram_good, P))).toEqual([])
    })
    test('class 2: the Kisaragi Cũ line is npc-quest-hook; the owner\'s “Cánh tay tôi bị cứa…” line is clean', () => {
        expect(rules(npcHits(fx.hook_bad, P))).toEqual(['npc-quest-hook'])
        expect(rules(npcHits(fx.hook_good, P))).toEqual([])
    })
    test('class 3: turn 13 against the card: asks for the painkillers she holds (npc-contradicts-need) in 4 sentences (npc-long); the owner\'s line is clean', () => {
        const ctx = { ...P, ledger: LEDGER, n: 13, playerText: 'thật ra tui có trong phòng 1 ít thuốc hạ sốt đấy' }
        const g = [...extractFacts(fx.contra_bad, foldNpc(LEDGER, 13), ctx).values()]
        expect(g).toHaveLength(1)
        expect(g[0].card?.id).toBe('ban-cong-704')
        expect([...g[0].facts.requests]).toEqual(['thuoc_giam_dau'])
        expect([...g[0].facts.refusals]).toEqual(['thuoc_ha_sot'])
        expect(rules(npcHits(fx.contra_bad, ctx)).sort()).toEqual(['npc-contradicts-need', 'npc-long'])
        expect(rules(npcHits(fx.contra_good, ctx))).toEqual([])
    })
    test('owner popup (b): refusing the fever medicine is allowed only with distrust AND a stated reason', () => {
        const say = (s: string, ledger = LEDGER) => rules(npcHits(`Cô lùi lại. “${s}”`, { ...P, ledger, n: 13 }))
        expect(say('Tôi chưa dám nhận đồ của người lạ, anh cứ giữ thuốc hạ sốt đi.')).toEqual([])
        expect(say('Anh cứ giữ thuốc hạ sốt đi.')).toEqual(['npc-contradicts-need'])
        expect(say('Tôi chưa dám nhận đồ của người lạ, anh cứ giữ thuốc hạ sốt đi.', LEDGER + '\n12 | ban-cong-704 | trust high')).toEqual(['npc-contradicts-need'])
    })
    test('owner popup (a): a direct question needs the address term', () => {
        const say = (s: string) => rules(npcHits(`Cô hỏi: “${s}”`, { ...P, ledger: LEDGER, n: 13 }))
        expect(say('Còn nhiều thuốc không?')).toEqual(['npc-address'])
        expect(say('Anh còn thuốc không, cho em xin ít?')).toEqual([])
        expect(say('Anh còn thuốc giảm đau không? Tay tôi đau lắm.')).toEqual([])
    })
    test('reported 2026-11-08: em+thầy or cậu+em in one speech is npc-address-pair; cho em xin is not', () => {
        expect(addressPairHits('Có phải em quên mang hồ sơ chưa? Hay là thầy đang đợi em ở đây?').map((h) => h.rule)).toEqual(['npc-address-pair'])
        expect(addressPairHits('Cậu đi đâu vậy? Em quên hồ sơ rồi à?').map((h) => h.rule)).toEqual(['npc-address-pair'])
        expect(addressPairHits('Anh còn thuốc không, cho em xin ít?')).toEqual([])
        expect(rules(npcHits('Naru hỏi: “Có phải em quên mang hồ sơ chưa? Hay là thầy đang đợi em ở đây?”', P))).toContain('npc-address-pair')
        expect(npcRewriteNote(npcHits('Naru hỏi: “Có phải em quên mang hồ sơ chưa? Hay là thầy đang đợi em ở đây?”', P))).toContain('npc-address-pair')
    })
    test('class 4: unprompted motive is npc-exposition; asked "tại sao", it is not', () => {
        const line = 'Cô quay đi. “Tôi không biết ngoài kia chuyện gì xảy ra hơn anh đâu. Tôi chỉ đang cố giữ cánh tay này khỏi nhiễm trùng.”'
        expect(rules(npcHits(line, { ...P, ledger: LEDGER, n: 15 }))).toEqual(['npc-exposition'])
        expect(rules(npcHits(line, { ...P, ledger: LEDGER, n: 15, playerText: 'tại sao cô không qua đây?' }))).toEqual([])
    })
    test('the player\'s own words are never graded (named speaker, or the bare-quote paragraph that opens the reply)', () => {
        expect(npcHits('Kenji Park hỏi: “Còn nhiều thuốc không?”', P)).toEqual([])
        expect(npcHits('“Còn nhiều thuốc không?”\n\nGió thổi.', P)).toEqual([])
    })
})

describe('the GM note and the fallback', () => {
    test('the card is at most 160 words and says needs, holds, received and trust', () => {
        const c = foldNpc(LEDGER, 13).get('ban-cong-704')!
        const line = cardLine(c)
        expect(line.split(/\s+/).length).toBeLessThanOrEqual(160)
        for (const w of ['Người phụ nữ ban công 704', 'cần thuốc hạ sốt', 'đang giữ thuốc giảm đau', 'tin người chơi: thấp']) expect(line).toContain(w)
        const big = foldNpc(Array.from({ length: 300 }, (_, i) => `1 | x | knows+ fact number ${i} with several words`).join('\n')).get('x')!
        expect(cardLine(big).split(/\s+/).length).toBeLessThanOrEqual(161)
    })
    test('npcCardsNote: only NPCs active in the last 3 replies; the inner-line rule alone without a ledger', () => {
        expect(npcCardsNote('', 13)).not.toContain('NPC cards')
        expect(npcCardsNote(LEDGER, 13)).toContain('NPC cards (hidden, never named)')
        expect(npcCardsNote(LEDGER, 30)).not.toContain('NPC cards')
    })
    test('rewrite note names the rule, the quote and the card; cut drops the hook sentence only when one sentence remains', () => {
        const hits = npcHits(fx.contra_bad, { ...P, ledger: LEDGER, n: 13, playerText: 'thật ra tui có ít thuốc hạ sốt' })
        const note = npcRewriteNote(hits, LEDGER, 13)
        expect(note).toContain('(npc-contradicts-need)')
        expect(note).toContain('Thẻ NPC: NPC “Người phụ nữ ban công 704”')
        const reply = 'Cô nhìn anh. “Cánh tay tôi bị cứa. Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được thuốc ở đó, tôi sẽ tin lời anh hơn.”'
        const cut = cutViolations(reply, npcHits(reply, P))
        expect(cut.cut).toEqual(['npc-quest-hook'])
        expect(cut.text).toBe('Cô nhìn anh. “Cánh tay tôi bị cứa.”')
        expect(cutViolations(fx.hook_bad, npcHits(fx.hook_bad, P)).cut).toEqual([])   // one sentence only: nothing left to keep, no cut
    })
})

describe('the three techniques of 2026-11-05: inner line, voice card, presence', () => {
    const L2 = LEDGER + '\n11 | ban-cong-704 | voice 14;thưa,quý khách;nói ngắn, hay hỏi lại;Anh còn thuốc không?\n11 | * | event kenji-bi-can;vết cắn,bị cắn\n11 | ban-cong-704 | present ban-cong-sang'
    const say = (s: string, inner = '', ledger = L2) => rules(npcHits(`Cô nhìn sang.${inner ? `\n${inner}` : ''}\n“${s}”`, { ...P, ledger, n: 13 }))
    test('the inner line parses, and refusing what it says she wants now is npc-inner; saying what she withholds too', () => {
        expect(parseInner('[[NPC|Ban công 704|thuốc hạ sốt|sợ|chồng tôi đã bị cắn]]').get('ban-công-704')).toEqual({ wants: 'thuốc hạ sốt', feels: 'sợ', withholding: 'chồng tôi đã bị cắn' })
        const inner = '[[NPC|ban-cong-704|đồ ăn|đói, sợ|chồng tôi đã bị cắn hôm qua]]'
        expect(say('Anh cứ giữ đồ ăn đi.', inner)).toContain('npc-inner')
        expect(say('Chồng tôi bị cắn hôm qua rồi.', inner)).toContain('npc-inner')
        expect(say('Anh còn đồ ăn không? Tôi đói lắm.', inner)).toEqual([])
    })
    test('voice card: a forbidden word or a sentence longer than her 14 words is npc-voice; the card shows her voice', () => {
        expect(say('Thưa anh, anh còn thuốc không?')).toEqual(['npc-voice'])
        expect(say('Anh còn thuốc giảm đau không, vì cả đêm qua tay tôi cứ đau nhức mãi mà tôi không biết phải làm sao nữa?')).toEqual(['npc-voice'])
        const card = cardLine(foldNpc(L2, 13).get('ban-cong-704')!)
        for (const w of ['câu tối đa 14 chữ', 'không bao giờ nói: thưa, quý khách', 'ví dụ: “Anh còn thuốc không?”']) expect(card).toContain(w)
        expect(card.split(/\s+/).length).toBeLessThanOrEqual(160)
    })
    test('presence: she mentions the bite she did not see and was not told: npc-unwitnessed; after "learn" she may', () => {
        expect(say('Anh bị cắn rồi phải không? Tôi sợ lắm.')).toEqual(['npc-unwitnessed'])
        expect(say('Anh bị cắn rồi phải không? Tôi sợ lắm.', '', L2 + '\n12 | ban-cong-704 | learn kenji-bi-can')).toEqual([])
    })
    test('the cut drops the sentence that names the unwitnessed event when another sentence stays', () => {
        const reply = 'Cô nhìn sang. “Tay tôi đau lắm. Anh bị cắn rồi phải không?”'
        const hits = npcHits(reply, { ...P, ledger: L2, n: 13 })
        expect(cutViolations(reply, hits)).toEqual({ text: 'Cô nhìn sang. “Tay tôi đau lắm.”', cut: ['npc-unwitnessed'] })
    })
    test('the GM note always carries the inner-line rule; the cards follow when there are any', () => {
        expect(npcCardsNote('', 13)).toContain('[[NPC|<their id')
        expect(npcCardsNote(L2, 13)).toContain('NPC cards (hidden, never named)')
    })
})
