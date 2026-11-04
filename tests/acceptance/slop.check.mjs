// node --test slop.check.mjs : the slop metrics must separate machine-sounding prose from plain prose, and each must go red when broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stockGestures, perceptionDensity, openerRepetition, quietFiller, tailPattern, slopReport, STOCK_PHRASES } from './lib/slop.mjs'

const SRC = fs.readFileSync(fileURLToPath(new URL('./lib/slop.mjs', import.meta.url)), 'utf8')
/** The module with one exact piece of source replaced (slop.mjs has no imports, so a data: URL loads it). */
async function mutant(from, to) {
    assert.ok(SRC.includes(from), `mutation target missing: ${from}`)
    return import('data:text/javascript;base64,' + Buffer.from(SRC.replace(from, to)).toString('base64'))
}

const PLAIN = [
    'Kenji xách thùng nước lên tầng ba rồi đặt cạnh bếp gas. Bà Hạnh đang vá lại chiếc áo mưa bằng băng keo đen, không ngẩng lên khi anh vào. “Cháu mang được hai chai sát trùng và một bịch gạo,” anh nói. Bà đếm số chai trên đầu ngón tay, gật đầu, rồi chỉ vào tủ lạnh đã tắt từ tuần trước. Anh cất gạo vào đó, vì chuột không mở được cánh cửa ấy. Chiều nay phải sửa lại cái khóa cổng sau.',
    'Evelyn mở bản đồ trên điện thoại và khoanh đỏ ba con phố gần trường tiểu học. Cô bảo tuyến đó có xe buýt chết đường, đi bộ mất bốn mươi phút nếu không gặp đàn đông. Anh hỏi sao không đi theo bờ sông. Cô đáp rằng cầu Tân Thuận đã bị chặn bằng container, còn đò thì không ai dám chèo.',
]
const MACHINE = [
    'Anh khẽ nghiêng đầu, một thoáng nụ cười tinh quái hiện lên. Không biết từ lúc nào, mùi tanh đã len lỏi khắp căn phòng. Tim đập thình thịch, anh nhìn thấy gương mặt nhợt nhạt của cô. Như thể thời gian khựng lại giữa không trung. Anh nhìn cô, cảm thấy hơi thở nghẹn lại. Anh nhìn xuống, nghe thấy tiếng thì thầm lặng lẽ. Anh nhìn cô thật lâu. Anh nhìn lên, ngửi thấy mùi khét. Hành lang vẫn im. Không có tiếng động nào nữa.',
    'Anh khẽ gật đầu, ánh mắt dừng lại trên cánh cửa. Anh lắng nghe, nhưng chỉ thấy bóng tối. Anh nhìn quanh căn phòng, đôi mắt dường như tối lại. Căn hộ vẫn khóa. Điện thoại mất sóng.',
]
const rate = (f, r) => f(r).per100 ?? f(r).count

test('stock gestures: machine paragraph scores far above plain, hits are whole words', () => {
    assert.ok(stockGestures(MACHINE).per100 > 8)
    assert.ok(stockGestures(PLAIN).per100 < 1.5)
    assert.ok(stockGestures(MACHINE).per100 > 5 * stockGestures(PLAIN).per100)
    assert.equal(stockGestures(['Anh khẽ cười.']).count, 1)
    assert.equal(stockGestures(['Anh Khẽ cười.']).count, 1, 'case-insensitive')
    assert.equal(stockGestures(['Cô ấy khẽkhàng bước.']).count, 0, 'no match inside a longer word')
    assert.ok(STOCK_PHRASES.length >= 30)
})
test('perception verbs: counts nghe thấy once, per 100 words', () => {
    assert.ok(perceptionDensity(MACHINE).per100 > 3 * perceptionDensity(PLAIN).per100 + 3)
    assert.equal(perceptionDensity(['Anh nghe thấy tiếng gõ.']).count, 1)
    assert.equal(perceptionDensity(['Anh thấy, nhìn và ngửi.']).count, 3)
})
test('opener repetition: same first two words across sentences', () => {
    assert.ok(openerRepetition(MACHINE).topShare > 0.3)
    assert.ok(openerRepetition(PLAIN).topShare < 0.15)
    assert.equal(openerRepetition(MACHINE).opener, 'anh nhìn')
})
test('quiet filler: short silence sentences, not long ones', () => {
    assert.equal(quietFiller(['Hành lang vẫn im. Không có tiếng động nào nữa.']).count, 2)
    assert.equal(quietFiller(MACHINE).count, 2)
    assert.equal(quietFiller(PLAIN).count, 0)
    assert.equal(quietFiller(['Cả tòa nhà vẫn im lìm như một cái hố sâu dưới chân anh lúc này.']).count, 0, 'long sentence is not filler')
})
test('tail pattern: a reply ending on two short sentences', () => {
    assert.equal(tailPattern(['Anh mở cửa bước ra ngoài và đứng nhìn con phố vắng suốt một lúc lâu. Căn hộ vẫn khóa. Điện thoại mất sóng.']).count, 1)
    assert.equal(tailPattern(MACHINE).count, 2)
    assert.equal(tailPattern(PLAIN).count, 0)
    assert.equal(tailPattern(['Hành lang vẫn im lặng suốt buổi sáng hôm đó. Anh bước đi. [💡Kế hoạch| Không ]'.replace(' [💡Kế hoạch| Không ]', '')]).count, 0, 'one short sentence is no tail')
})
test('choice block after the prose is not narration', () => {
    const base = 'Anh xách thùng nước lên tầng ba rồi đặt cạnh bếp gas ngay trước mặt bà.'
    assert.equal(tailPattern([base + '\n[💡Kế hoạch| Không ]\n[Im. Yên.]']).count, 0)
})
test('slopReport: shape, hits and ordering (machine > plain, loa-rung last reply > plain)', () => {
    const m = slopReport(MACHINE), p = slopReport(PLAIN)
    assert.ok(m.score > p.score + 5, `${m.score} vs ${p.score}`)
    assert.deepEqual(Object.keys(m).sort(), ['hits', 'metrics', 'score'])
    for (const h of m.hits) assert.ok(h.rule && 'reply' in h && h.text)
    assert.equal(slopReport([]).score, 0)
    const loa = JSON.parse(fs.readFileSync(new URL('./fixtures/owner-chats/zombie-loa-rung-0204.json', import.meta.url), 'utf8')).data.message.filter((x) => x.role === 'char')
    const last = slopReport([loa.at(-1).data]).score
    assert.ok(last > p.score, `loa-rung last ${last} vs plain ${p.score}`)
})

// every metric goes red when its logic is broken once
test('mutation: empty stock list', async () => {
    const mod = await mutant("'khẽ', 'thoáng',", "'zzqq', 'zzqw',")
    assert.ok(mod.stockGestures(MACHINE).per100 < stockGestures(MACHINE).per100)
    assert.equal(mod.stockGestures(['Anh khẽ cười.']).count, 0) // the same assertion as the real test
})
test('mutation: lookarounds removed lets "khẽ" match inside a word', async () => {
    const mod = await mutant("const L = '(?<!\\\\p{L})', R = '(?!\\\\p{L})'", "const L = '', R = ''")
    assert.equal(mod.stockGestures(['Cô ấy khẽkhàng bước.']).count, 1) // broken: would fail the real "no match inside" assertion
})
test('mutation: perception list loses a verb', async () => {
    const mod = await mutant("'nhìn', 'ngửi']", "'nhìn']")
    assert.equal(mod.perceptionDensity(['Anh thấy, nhìn và ngửi.']).count, 2) // the real test expects 3
})
test('mutation: perception density compares the wrong way (per word instead of per 100)', async () => {
    const mod = await mutant('(n / w) * 100', 'n / w')
    assert.ok(mod.perceptionDensity(MACHINE).per100 < 1)
    assert.ok(perceptionDensity(MACHINE).per100 > 3)
})
test('mutation: opener uses only the first word', async () => {
    const mod = await mutant('`${w[0]} ${w[1]}`', 'w[0]')
    assert.notEqual(mod.openerRepetition(PLAIN).topShare, openerRepetition(PLAIN).topShare)
    assert.equal(mod.openerRepetition(MACHINE).opener, 'anh')
})
test('mutation: opener share inverted', async () => {
    const mod = await mutant('if (c > topN)', 'if (c < topN)')
    assert.notEqual(mod.openerRepetition(MACHINE).opener, 'anh nhìn')
})
test('mutation: quiet filler ignores the length cap', async () => {
    const mod = await mutant('words(s).length <= 6 && reQuiet', 'words(s).length >= 6 && reQuiet')
    assert.equal(mod.quietFiller(['Hành lang vẫn im. Không có tiếng động nào nữa.']).count, 1)
    assert.equal(quietFiller(['Hành lang vẫn im. Không có tiếng động nào nữa.']).count, 2)
})
test('mutation: quiet list emptied', async () => {
    const mod = await mutant("const QUIET = ['im', 'im lặng',", "const QUIET = ['zzqq', 'zzqw',")
    assert.equal(mod.quietFiller(['Hành lang vẫn im.']).count, 0)
})
test('mutation: tail needs only one short sentence', async () => {
    const one = ['Hành lang vẫn im lặng suốt buổi sáng hôm đó, kéo dài đến tận lúc mặt trời lên cao. Anh bước đi.']
    const mod = await mutant('if (k >= 2)', 'if (k >= 1)')
    assert.equal(mod.tailPattern(one).count, 1)
    assert.equal(tailPattern(one).count, 0)
})
test('mutation: tail looks at the first sentences instead of the last', async () => {
    const mod = await mutant('ss[ss.length - 1 - k]', 'ss[k]')
    assert.equal(mod.tailPattern(['Anh mở cửa bước ra ngoài và đứng nhìn con phố vắng suốt một lúc lâu. Căn hộ vẫn khóa. Điện thoại mất sóng.']).count, 0)
})
test('mutation: score ordering reverses when weights go negative', async () => {
    const mod = await mutant('const WEIGHTS = { stock: 2,', 'const WEIGHTS = { stock: -2,')
    assert.ok(mod.slopReport(MACHINE).score < slopReport(MACHINE).score)
})
