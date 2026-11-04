// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { stripStatTags } from './statsTags'
import { stripFind } from './findDrop'

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
