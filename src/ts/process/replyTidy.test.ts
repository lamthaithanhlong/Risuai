import { describe, expect, it } from 'vitest'
import { splitCoT } from '../parser/cot'
import { closeLeadingThought, dropPlanning, isPlanning, stripGmTalk, stripStrayMarks, tidyDisplay, tidyLastReply, tidyReply } from './replyTidy'
import { stripLooks } from './portraits'

const STORY1 = 'Gã trẻ không đứng dậy. Gã chỉ ngồi thẳng lưng hơn, bát trong tay hạ xuống, mắt không rời cánh cổng sắt.'
const STORY2 = '"Bà Đếm cho mày ngủ ngoài này à?" Marek hỏi, giọng khàn. Gió từ khe núi thổi qua, lạnh như lưỡi dao.'
// the shapes measured in the A/B (shortened): planning in English before and between the paragraphs of a Vietnamese story
const PLAN1 = 'The player has confirmed the character. Now I need to run Initialization: roll the Random Fate Engine once and then write the first STATUS block at the end of the reply.'
const PLAN2 = 'Dice: QUIET — no new trouble, so the choice plays out. Focus on the enemy; I should let the scene breathe and keep the beat where it is.'

describe('planning paragraphs leave a story told in Vietnamese', () => {
    it('knows planning from story, panels and short English', () => {
        expect(isPlanning(PLAN1)).toBe(true)
        expect(isPlanning(PLAN2)).toBe(true)
        expect(isPlanning(STORY1)).toBe(false)
        expect(isPlanning('☆ [Date: 2026-10-19 | Time: 08:00 | EXP 120 | the player level 3 and the next rank need 40 more points now]')).toBe(false)
        expect(isPlanning('"Run, and do not look back at the gate!"')).toBe(false)
    })
    it('drops planning before and between story paragraphs, keeps the story whole', () => {
        expect(dropPlanning(`${PLAN1}\n\n${STORY1}\n\n${PLAN2}\n\n${STORY2}`)).toBe(`${STORY1}\n\n${STORY2}`)
    })
    it('once a reply plans, its other English prose paragraphs go too (measured: they carry no planning word)', () => {
        const hmm = 'Hmm, Whitlock is not really an enemy, but a consequence should land after she arrives at the shop.'
        const simpler = 'Simpler: consequence = the alley man was there before her, sitting on the step.'
        expect(dropPlanning(`${STORY1}\n\n${PLAN2}\n\n${hmm}\n\n${simpler}\n\n${STORY2}`)).toBe(`${STORY1}\n\n${STORY2}`)
        // without a planning paragraph an English line in a Vietnamese story stays (a sign, a letter read aloud)
        const letter = 'To whom it may concern: the bearer of this card is under the protection of the Church.'
        expect(dropPlanning(`${STORY1}\n\n${letter}\n\n${STORY2}`)).toBe(`${STORY1}\n\n${letter}\n\n${STORY2}`)
    })
    it('leaves a story told in English alone, and a reply without planning', () => {
        const en = 'The fog rolled over Tingen as she walked home. I need to find the man who left the card, she thought, and the reply will have to wait until dawn.'
        expect(dropPlanning(`${PLAN1}\n\n${en}`)).toBe(`${PLAN1}\n\n${en}`)
        expect(dropPlanning(`${STORY1}\n\n${STORY2}`)).toBe(`${STORY1}\n\n${STORY2}`)
    })
})

describe('GM note lines outside a [[GM]] block', () => {
    it('are taken out; story lines and the hidden block are not', () => {
        const t = `${STORY1}\n[GM: arc seeded, beat 1]\n(GM note: the side's first order is due)\nGM note says the threat creeps.\nDice: ADVANCE — the next event\nFocus: the side (pháo đài)\n[Ngươi đã bước vào Cơn Ác Mộng Đầu Tiên.]\n${STORY2}\n[[GM\nbeat: 2 | x | y\n]]`
        expect(stripGmTalk(t)).toBe(`${STORY1}\n[Ngươi đã bước vào Cơn Ác Mộng Đầu Tiên.]\n${STORY2}\n[[GM\nbeat: 2 | x | y\n]]`)
        expect(stripGmTalk('Gió nổi. Focus: anh nhìn vào ngọn đèn.')).toBe('Gió nổi. Focus: anh nhìn vào ngọn đèn.')
    })
})

describe('a thought opened and never closed at the start of a finished reply', () => {
    it('is closed where the Vietnamese story starts: the story shows, the reasoning stays stored', () => {
        const raw = `<thinking>${PLAN1}\n\nShe should hesitate first.\n\n${STORY1}\n\n${STORY2}`
        const fixed = closeLeadingThought(raw)
        expect(fixed).toBe(`<thinking>${PLAN1}\n\nShe should hesitate first.</thinking>\n\n${STORY1}\n\n${STORY2}`)
        const split = splitCoT(fixed)
        expect(split.main.trim()).toBe(`${STORY1}\n\n${STORY2}`)
        expect(split.thoughts[0]).toContain('Initialization')
        // without the repair the whole story would be hidden in the thought panel
        expect(splitCoT(raw).main).toBe('')
    })
    it('leaves a closed thought, a thought with no story after it yet, and a reply without a thought', () => {
        const closed = `<thinking>${PLAN1}</thinking>\n\n${STORY1}`
        expect(closeLeadingThought(closed)).toBe(closed)
        expect(closeLeadingThought(`<thinking>${PLAN1}\n\nMore plan.`)).toBe(`<thinking>${PLAN1}\n\nMore plan.`)
        expect(closeLeadingThought(STORY1)).toBe(STORY1)
    })
})

describe('stored and shown', () => {
    it('the last reply is stored tidy, other messages are not touched', () => {
        const chat = { message: [{ role: 'user', data: PLAN1 }, { role: 'char', data: `${PLAN1}\n\n${STORY1}\n[GM: x]` }] }
        expect(tidyLastReply(chat)).toBe(true)
        expect(chat.message[1].data).toBe(STORY1 + '\n')
        expect(chat.message[0].data).toBe(PLAN1)
        expect(tidyLastReply(chat)).toBe(false)
        const typed = { message: [{ role: 'user', data: `${PLAN1}\n\n${STORY1}` }] }
        expect(tidyLastReply(typed)).toBe(false)
        expect(typed.message[0].data).toBe(`${PLAN1}\n\n${STORY1}`)
    })
    it('the screen hides the same things, the stored repair keeps the thought', () => {
        expect(tidyDisplay(`${PLAN2}\n\n${STORY1}\n(GM note: x)`)).toBe(STORY1 + '\n')
        expect(tidyReply(`<think>${PLAN1}\n\n${STORY1}`)).toBe(`<think>${PLAN1}</think>\n\n${STORY1}`)
        // planning outside the thought goes; the thought itself is kept as written, for the model and the thought panel
        const plan3 = 'I should let the scene breathe first; the player wants the gate, so the reply opens on the wall and the beat stays.'
        expect(tidyReply(`<think>${PLAN1}</think>\n\n${plan3}\n\n${STORY1}`)).toBe(`<think>${PLAN1}</think>\n\n${STORY1}`)
    })
})

describe('measured 2026-10-19 (gpt-6-luna, Mailman t3): a panel block opened with a CJK bracket was shown as text', async () => {
    const { fixBlockBrackets, fixLastReplyBlocks } = await import('./replyTidy')
    const T3 = 'Ông ta mờ dần giữa màn sương.\n\n【STATUS\nname: Phác Mẫn\nnotes: Chưa có sách tem, điểm hay nhiệm vụ\n]]\n\n[[LOOK Phác Mẫn | Black hair]]'
    it('the opener goes back to "[[STATUS" (and its kind), a CJK closer to "]]"; prose and right blocks are untouched', () => {
        expect(fixBlockBrackets(T3)).toBe(T3.replace('【STATUS', '[[STATUS'))
        expect(fixBlockBrackets('a\n［［LEDGER\nmem: x\n］］')).toBe('a\n[[LEDGER\nmem: x\n]]')
        expect(fixBlockBrackets('a\n[STATUS\nplace: X\n]]')).toBe('a\n[[STATUS\nplace: X\n]]')
        expect(fixBlockBrackets('a\n[[ GM\nbeat: 1\n]]')).toBe('a\n[[GM\nbeat: 1\n]]')
        const ok = 'Văn.\n[[STATUS\nplace: X\n]]\n[Ứng viên! Chào mừng đến với Ác Mộng Ma Pháp.]'
        expect(fixBlockBrackets(ok)).toBe(ok)
        expect(fixBlockBrackets('Cô nói 【STATUS là gì】 rồi cười.')).toBe('Cô nói 【STATUS là gì】 rồi cười.')
    })
    it('only the last story reply is fixed', () => {
        const chat = { message: [{ role: 'user', data: '【STATUS\nx: y\n]]' }, { role: 'char', data: T3 }] }
        expect(fixLastReplyBlocks(chat)).toBe(true)
        expect(chat.message[1].data).toContain('\n[[STATUS\nname: Phác Mẫn')
        expect(chat.message[0].data).toBe('【STATUS\nx: y\n]]')
        expect(fixLastReplyBlocks(chat)).toBe(false)
    })
})

describe('measured 2026-10-19 (story slot through ChatGPT web): the reply came back as copied Markdown, no block reached the card', async () => {
    const { fixBlockBrackets, fixLastReplyBlocks, unMarkdown } = await import('./replyTidy')
    // shortened from the acceptance record (Shadow Slave t3/t4)
    const WEB = 'Màn hình máy theo dõi bỗng tối đen.\n\n\\[Ứng viên! Chào mừng đến với Ác Mộng Ma Pháp.\\]\n\n'
        + '[img: A crumbling stone temple under cold rain](<img: A crumbling stone temple under cold rain.md>)\n\n'
        + '[Dark brown hair, grey eyes, plain grey linen tunic](<LOOK Elias Mercer.md>)\n\n'
        + '\\[\\[STATUS  \nname: Elias Mercer  \nplace: Đền đổ nát  \n\\]\\]\n\n\\[\\[GM  \nbeat: 2 | Elias kiểm tra | chờ  \n\\]\\]\\]'
    it('puts back the blocks, the Spell\'s brackets and the tags the copy turned into links', () => {
        expect(fixBlockBrackets(WEB)).toBe('Màn hình máy theo dõi bỗng tối đen.\n\n[Ứng viên! Chào mừng đến với Ác Mộng Ma Pháp.]\n\n'
            + '[[img: A crumbling stone temple under cold rain]]\n\n'
            + '[[LOOK Elias Mercer | Dark brown hair, grey eyes, plain grey linen tunic]]\n\n'
            + '[[STATUS\nname: Elias Mercer\nplace: Đền đổ nát\n]]\n\n[[GM\nbeat: 2 | Elias kiểm tra | chờ\n]]')
        const chat = { message: [{ role: 'user', data: 'đi' }, { role: 'char', data: WEB }] }
        expect(fixLastReplyBlocks(chat)).toBe(true)
        expect(chat.message[1].data).toMatch(/^\[\[STATUS\nname: Elias Mercer$/m)
    })
    it('leaves a plain reply alone, a real link and prose with backslashes included', () => {
        const plain = 'Văn.\n\n[[STATUS\nplace: X\n]]\n[Ứng viên!]  \nGiá 5*3 \\ không đổi. Xem [trang](https://x.vn).'
        expect(unMarkdown(plain)).toBe(plain)
        expect(fixBlockBrackets(plain)).toBe(plain)
    })
})

describe('measured 2026-10-19 evening (gpt-6-luna, Mailman t10): a block of the narrator\'s own name, full of GM lines, was shown', async () => {
    const { fixBlockBrackets } = await import('./replyTidy')
    const { gmBlocks, stripGm } = await import('./gameMaster')
    const T10 = 'Hắn bước tới, cành gãy kéo trên đá ken két. Hắn nâng cành lên lần nữa, ánh mắt không rời hòn đá.\n\n[[GM\nbeat: 8 | Tôn Minh Hạo nép bờ kè, nắm hòn đá; kẻ lạ áp sát | Quyết định cách đối phó với đòn tiếp theo\n]]\n[[CHANGE\nenemy: Kẻ lạ cầm cành trúc | Áp sát, tiếp tục tấn công\nthreat: Bờ kè chặn một hướng lùi | Đòn cành trúc sắp tới\n]]'
    it('becomes a GM block: its lines reach the notes and the player sees none of it', () => {
        const fixed = fixBlockBrackets(T10)
        expect(fixed).not.toContain('[[CHANGE')
        expect(gmBlocks(fixed).join('\n')).toContain('enemy: Kẻ lạ cầm cành trúc')
        expect(gmBlocks(fixed).join('\n')).toContain('threat: Bờ kè chặn một hướng lùi')
        expect(stripGm(fixed)).not.toMatch(/\[\[|enemy:|threat:/)
    })
    it('a known block, or one with any line that is not a GM line, is left as it is', () => {
        const look = '[[LOOK\nbeat: x\n]]'
        expect(fixBlockBrackets(look)).toBe(look)
        const other = 'Văn.\n\n[[NOTE\nenemy: a | b\nhắn cười\n]]'
        expect(fixBlockBrackets(other)).toBe(other)
    })
})

// The Zombie chat export of 2026-10-23, lines as written there
describe('format leaks of the Zombie chat (2026-10-23)', () => {
    const body = 'Evelyn liếc cánh cửa, rồi nhìn chiếc găng tay còn lỏng ốc. “Ừm. Tiếng động này chắc chắn được chú ý rồi.” Cú nện thứ hai vang lên, nặng hơn, làm cánh cửa khẽ bật trong khung.'
    it('a "]]" left alone at the end of a reply (4 of 54) is taken out of the stored reply and of what is shown', () => {
        const raw = `${body}\n\n]]`
        expect(tidyReply(raw)).toBe(body)
        expect(tidyDisplay(raw)).toBe(body)
        expect(stripStrayMarks(`${body}\n\n]]\n\nNgười đàn ông nhìn.`)).toBe(`${body}\n\nNgười đàn ông nhìn.`)
    })
    it('a block that is still whole keeps its closer: only a closer with no opener goes', () => {
        const whole = `${body}\n\n[[STATUS\n$st_day: Ngày 4\n]]`
        expect(stripStrayMarks(whole)).toBe(whole)
        expect(stripStrayMarks(`${whole}\n]]`)).toBe(whole)
    })
    it('the narrator\'s aside to itself written as a System line is not story ("【SYSTEM: HỆ THỐNG HACKER】— no, nothing.")', () => {
        const raw = '【SYSTEM: HỆ THỐNG HACKER】— no, nothing.\n\nEvelyn gật đầu rồi lướt xuyên qua cửa căn 704.'
        expect(tidyReply(raw)).toBe('Evelyn gật đầu rồi lướt xuyên qua cửa căn 704.')
        // a real System line in Vietnamese stays
        const real = '【GHI NHẬN: Mẫu người nhiễm — đã ngừng tín hiệu. Dữ liệu điểm yếu: xác nhận.】'
        expect(tidyReply(`${body}\n\n${real}`)).toBe(`${body}\n\n${real}`)
    })
    it('[[LOOK …]] is for the portraits only: the screen never shows it (the export keeps the stored text, as it does {{inlay::…}})', () => {
        const look = '[[LOOK Người đàn ông bị thương | Short graying hair, brown eyes, weathered face, lean build, late forties, bloodstained office shirt and dark trousers]]'
        expect(stripLooks(`${body}\n\n${look}`)).not.toContain('[[LOOK')
        expect(stripLooks(`${body}\n\n${look}`)).toContain('chiếc găng tay')
    })
})
