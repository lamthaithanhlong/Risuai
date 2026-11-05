// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { stripStatTags } from './statsTags'
import { stripFind } from './findDrop'
import { tidyDisplay, tidyReply } from './replyTidy'

describe('stripStatTags', () => {
    it('takes a finished ACT tag out, with the line it stood on', () => {
        expect(stripStatTags('Anh nâng cánh cửa.\n[[ACT|nâng-cửa|suc_manh|hard|]]')).toBe('Anh nâng cánh cửa.')
        expect(stripStatTags('Anh nâng cánh cửa. [[ACT|nâng-cửa|suc_manh+the_luc|normal|stair-ear+x]] Cửa mở.')).toBe('Anh nâng cánh cửa. Cửa mở.')
    })
    it('takes BREAK out, and both when a reply has both', () => {
        expect(stripStatTags('Qua rồi.\n[[ACT|chạy|the_luc|near_death|]]\n[[BREAK|the_luc]]')).toBe('Qua rồi.')
    })
    it('hides a tag still being streamed, at every length', () => {
        for (const tail of ['[[A', '[[AC', '[[ACT', '[[ACT|nâng-cửa|suc_', '[[ACT|nâng-cửa|suc_manh|hard|', '[[B', '[[BRE', '[[BREAK|y_c']) {
            expect(stripStatTags('Anh thở ra.\n' + tail)).toBe('Anh thở ra.')
        }
    })
    it('leaves other blocks and ordinary text alone', () => {
        const t = 'Anh nghe thấy.\n[💡Kế hoạch| Không ]\n[[STATUS\nday: 2\n]]'
        expect(stripStatTags(t)).toBe(t)
        expect(stripStatTags('Chữ [[ABC]] giữa câu')).toBe('Chữ [[ABC]] giữa câu')
        expect(stripStatTags('')).toBe('')
        expect(stripStatTags('  khoảng trắng cuối  ')).toBe('  khoảng trắng cuối  ')
    })
    it('keeps the FIND line to its own stripper and the STATUS block untouched in between', () => {
        const t = 'Anh nghe.\n[[ACT|nghe|cam_nhan|normal|]]\n[[STATUS\nday: 2\n]]'
        expect(stripStatTags(t)).toBe('Anh nghe.\n[[STATUS\nday: 2\n]]')
        expect(stripStatTags(stripFind('Anh nghe.\n[[FIND|skill|a|b|c|common|d|yes]]\n[[ACT|nghe|cam_nhan|normal|]]'))).toBe('Anh nghe.')
    })
    it('is idempotent', () => {
        const once = stripStatTags('Xong.\n[[ACT|x|suc_manh|normal|]]\n[[BREAK|suc_manh]]')
        expect(stripStatTags(once)).toBe(once)
    })
})

describe('stripStatTags: the forms the narrator really wrote (gate runs, 2026-11-04)', () => {
    const FORMS = [
        '[[ACT leo-cầu-thang|the_luc+cam_nhan|normal|]]',
        '[[ACT dọn-chỗ-nấp|suc_manh+cam_nhan|trivial|]]',
        '[[act|nghe|cam_nhan|normal|]]',
        '[[ ACT | nghe | cam_nhan | normal | ]]',
        '[[ACT|nghe|cam_nhan|normal|]',
        '[[Break y_chi]]',
        '[[ACT|nghe|cam_nhan|normal|',
    ]
    for (const tag of FORMS) {
        it(`takes out ${tag}`, () => {
            expect(stripStatTags(`Anh nghe.\n[💡Kế hoạch| Không ] ${tag}`)).toBe('Anh nghe.\n[💡Kế hoạch| Không ]')
            expect(stripStatTags(`Anh nghe. ${tag}\n[[STATUS\nday: 2\n]]`)).toBe('Anh nghe.\n[[STATUS\nday: 2\n]]')
        })
    }
    it('leaves a word that only starts like a tag alone', () => {
        expect(stripStatTags('[[ACTION|x]] và [[BREAKFAST]]')).toBe('[[ACTION|x]] và [[BREAKFAST]]')
    })
})

describe('stripStatTags: the quest tags (quests.lua, ~/.risu-story-work/quest-tag-grammar.md)', () => {
    // done / fail close the quest, progress (2026-11-05, ZR quest-goal) says how many of the count the character has now; quests.lua cuts all three from
    // the stored message, but the stream shows them before the Lua runs. The client only hides them, it never reads them.
    const FORMS = [
        '[[QUEST|done|gia-co-cua]]', '[[QUEST|fail|gia-co-cua]]',
        '[[QUEST|progress|nuoc-sach|1]]', '[[QUEST progress|nuoc-sach|2]]', '[[QUEST|progress|nuoc-sach 2]]', '[[ quest | Progress | nuoc-sach | 1 ]]',
        '[[QUEST|progress|nuoc-sach|1]', '[[QUEST|progress|nuoc-sach|1', '[[QUEST done|gia-co-cua]]',
    ]
    for (const tag of FORMS) {
        it(`takes out ${tag}`, () => {
            expect(stripStatTags(`Anh tìm thấy chai đầu tiên.\n[💡Kế hoạch| Không ] ${tag}`)).toBe('Anh tìm thấy chai đầu tiên.\n[💡Kế hoạch| Không ]')
            expect(stripStatTags(`Anh tìm thấy chai đầu tiên. ${tag}\n[[STATUS\nday: 2\n]]`)).toBe('Anh tìm thấy chai đầu tiên.\n[[STATUS\nday: 2\n]]')
        })
    }
    it('takes out a progress tag and a done tag of the same reply', () => {
        expect(stripStatTags('Chai thứ hai nằm sau tủ lạnh.\n[[QUEST|progress|nuoc-sach|2]]\n[[QUEST|done|nuoc-sach]]')).toBe('Chai thứ hai nằm sau tủ lạnh.')
    })
    it('hides a quest tag still being streamed, at every length', () => {
        for (const tail of ['[[Q', '[[QU', '[[QUE', '[[QUES', '[[QUEST', '[[QUEST|', '[[QUEST|pro', '[[QUEST|progress|nuoc-s', '[[QUEST|progress|nuoc-sach|1', '[[QUEST|do']) {
            expect(stripStatTags('Anh thở ra.\n' + tail)).toBe('Anh thở ra.')
        }
    })
    it('leaves words that only start like a quest tag alone', () => {
        expect(stripStatTags('[[QUESTION|x]] và [[QUESTLOG]]')).toBe('[[QUESTION|x]] và [[QUESTLOG]]')
        expect(stripStatTags('Chữ [[Quý]] giữa câu')).toBe('Chữ [[Quý]] giữa câu')
    })
})

describe('stripStatTags: the NPC inner line (2026-11-05)', () => {
    it('takes a finished [[NPC|…]] line out, and one still being streamed', () => {
        const reply = 'Cô nhìn sang.\n[[NPC|ban-cong-704|thuốc hạ sốt|sợ, đau|vết cắn của chồng]]\n“Anh còn thuốc giảm đau không? Tay tôi đau lắm.”'
        expect(stripStatTags(reply)).toBe('Cô nhìn sang.\n“Anh còn thuốc giảm đau không? Tay tôi đau lắm.”')
        for (const tail of ['[[N', '[[NP', '[[NPC', '[[NPC|ban-cong', '[[NPC|ban-cong-704|thuốc']) expect(stripStatTags('Cô nhìn sang.\n' + tail)).toBe('Cô nhìn sang.')
    })
    it('leaves words that only start with N alone ([[img: …]] and prose)', () => {
        expect(stripStatTags('Nắng lên. [[img: a balcony]]')).toBe('Nắng lên. [[img: a balcony]]')
    })
})

describe('stripStatTags: every hidden tag in one reply (release-2: quest-tag + npc-state merged)', () => {
    // ACT, BREAK, QUEST (done / fail / progress), NPC and FIND in the same reply, the way the screen (parser.svelte.ts: stripFind then
    // stripStatTags, then tidyDisplay) and the stored text (noteFind's stripFind, then tidyReply) take them out. At every length the stream
    // can stop at, no "[[" and nothing a tag carries may show; the finished reply keeps exactly the prose.
    const PROSE = ['Cô nhìn sang.', '“Anh còn thuốc giảm đau không?”', 'Anh đưa chai nước, rồi nâng cánh cửa.', 'Chai thứ hai nằm sau tủ lạnh.']
    const REPLY = [
        PROSE[0],
        '[[NPC|ban-cong-704|thuốc hạ sốt|sợ, đau|vết cắn của chồng]]',
        PROSE[1],
        PROSE[2] + ' [[ACT|nâng-cửa|suc_manh+the_luc|hard|]]',
        '[[BREAK|the_luc]]',
        PROSE[3],
        '[[QUEST|progress|nuoc-sach|2]]',
        '[[QUEST|done|nuoc-sach]]',
        '[[QUEST|fail|gia-co-cua]]',
        '[[FIND|skill|Mở khóa|Lockpick|mở khóa nhanh|common|có dụng cụ|yes]]',
    ].join('\n')
    const PAYLOAD = ['ban-cong', 'thuốc hạ', 'vết cắn', 'suc_manh', 'the_luc', 'nâng-cửa', 'nuoc-sach', 'gia-co-cua', 'progress', 'Lockpick', 'Mở khóa']
    const screen = (t: string) => tidyDisplay(stripStatTags(stripFind(t)))
    const stored = (t: string) => tidyReply(stripFind(t))
    it('the finished reply keeps only the prose, on the screen and in the stored text', () => {
        const clean = [PROSE[0], PROSE[1], PROSE[2], PROSE[3]].join('\n')
        expect(screen(REPLY)).toBe(clean)
        expect(stored(REPLY)).toBe(clean)
        // the stored path without its FIND pass still takes out every other kind
        expect(tidyReply(REPLY.replace(/\n\[\[FIND[^\n]*$/, ''))).toBe(clean)
    })
    it('hides every tag at every streaming prefix length', () => {
        for (let n = 1; n <= REPLY.length; n++) {
            const part = REPLY.slice(0, n)
            for (const [name, out] of [['screen', screen(part)], ['stored', stored(part)]] as const) {
                const where = `${name} at ${n}: ${JSON.stringify(part.slice(-30))} -> ${JSON.stringify(out.slice(-40))}`
                expect(out.includes('[['), where).toBe(false)
                for (const p of PAYLOAD) expect(out.includes(p), `${where} shows ${p}`).toBe(false)
            }
        }
    })
    it('still leaves look-alike words and other blocks alone', () => {
        const t = 'Nắng lên. [[img: a balcony]] [[QUESTION|x]] [[NPCS]] [[ACTION|y]] [[BREAKFAST]]\n[[STATUS\nday: 2\n]]'
        expect(stripStatTags(t)).toBe(t)
    })
})
