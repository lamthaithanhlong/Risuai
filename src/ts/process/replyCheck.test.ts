import { describe, expect, it } from 'vitest'
import viReplies from './replyLang.fixture.json'
import { consecutiveRepeat, consecutiveSceneRepeat, malformedTags, tagWellFormed, dialogueRepeats, languageDrift, languageHits, narrationOf, replyHits, setupHits, systemLineRepeats, verbatimRepeats } from './replyCheck.mjs'
import { narrationProblems } from '../../../tests/acceptance/lib/narration.mjs'
import { regenerationNote, settleReply, shouldRegenerate } from './replyRegen'
import { alreadyTold, guideDirective, guideNote, verbatimAvoid } from './guideDirective'

const prev1 = 'Tiếng cào ngoài hành lang ngừng hẳn. Hana ngồi sát cửa.\n【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】\nHana: “Cậu muốn tớ nhìn qua bên kia không? Tớ hơi sợ đấy.”'
const clean = 'Kenji nắm chặt cán dao và đếm nhịp thở của mình.\n【HỆ THỐNG: Điểm sinh tồn 11/20 | Thức ăn 3】\nHana: “Tớ nghe thấy tiếng bước chân dưới cầu thang.”'

describe('replyCheck', () => {
    it('setup exposition', () => {
        expect(setupHits('Cô gái đó chỉ mình Kenji thấy được.')).toHaveLength(1)
        expect(setupHits('Evelyn là người bạn thân đã mất của cậu.')).toHaveLength(1)
        expect(replyHits('Evelyn là người bạn thân đã mất của cậu.', []).map((h) => h.rule)).toEqual(['setup'])
        expect(setupHits(clean)).toEqual([])
    })
    it('same scene sentence in two consecutive replies', () => {
        const cur = 'Tiếng cào ngoài hành lang ngừng hẳn! Kenji đứng yên lắng nghe.'
        expect(verbatimRepeats(cur, [prev1])).toEqual(['Tiếng cào ngoài hành lang ngừng hẳn!'])
        expect(replyHits(cur, [prev1]).map((h) => h.rule)).toEqual(['repeat'])
    })
    it('identical System line hits, a changed value does not', () => {
        const cur = 'Kenji thở ra.\n【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】'
        expect(systemLineRepeats(cur, [prev1])).toHaveLength(1)
        expect(replyHits(cur, [prev1]).map((h) => h.rule)).toEqual(['system'])
        expect(systemLineRepeats(clean, [prev1])).toEqual([])
        expect(replyHits('【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】', ['【HỆ THỐNG:   Điểm sinh tồn 12/20 | Thức ăn 3】'])).toHaveLength(1)
    })
    it('the guide repeating a whole sentence', () => {
        const cur = 'Hana: “Cậu muốn tớ nhìn qua bên kia không?”'
        expect(replyHits(cur, [prev1]).map((h) => h.rule)).toEqual(['repeat'])
    })
    it('a clean reply has no hits; short sentences and old replies are ignored', () => {
        expect(replyHits(clean, [prev1])).toEqual([])
        expect(verbatimRepeats('Im quá. Hana ngồi sát cửa.', ['Im quá. Hana ngồi sát cửa.'])).toEqual([])
        expect(verbatimRepeats('Tiếng cào ngoài hành lang ngừng hẳn.', [prev1, 'a', 'b', 'c'])).toEqual([])
        expect(verbatimRepeats('Tiếng cào ngoài hành lang ngừng hẳn.', [prev1, 'a', 'b', 'c'], 4)).toHaveLength(1)
    })
})

describe('regenerate once', () => {
    const hits = replyHits('Tiếng cào ngoài hành lang ngừng hẳn. Chỉ mình Kenji thấy.\n【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】', [prev1])
    it('shouldRegenerate: only first attempt with hits', () => {
        expect(shouldRegenerate(hits, 0)).toBe(true)
        expect(shouldRegenerate(hits, 1)).toBe(false)
        expect(shouldRegenerate([], 0)).toBe(false)
    })
    it('note names each hit', () => {
        const n = regenerationNote(hits)
        expect(n).toContain('setup exposition "Chỉ mình Kenji thấy"')
        expect(n).toContain('repeated sentence "Tiếng cào ngoài hành lang ngừng hẳn."')
        expect(n).toContain('unchanged System line "【HỆ THỐNG')
        expect(regenerationNote([])).toBe('')
    })
    it('redoes a repeat at most twice (see replyRegen.test.ts), never loops, keeps first when redo fails', async () => {
        const dirty = 'Tiếng cào ngoài hành lang ngừng hẳn.'
        let calls = 0
        const warns: string[] = []
        expect(await settleReply(dirty, [prev1], async (note) => { calls++; expect(note).toContain('repeated sentence'); return clean }, (m) => warns.push(m))).toBe(clean)
        expect(calls).toBe(1); expect(warns).toEqual([])
        calls = 0
        expect(await settleReply(dirty, [prev1], async () => { calls++; return dirty }, (m) => warns.push(m))).toBe(dirty)
        expect(calls).toBe(2); expect(warns[0]).toContain('still has')
        expect(await settleReply(dirty, [prev1], async () => null)).toBe(dirty)
        expect(await settleReply(clean, [prev1], async () => { throw new Error('no') })).toBe(clean)
    })
})

describe('directive avoids verbatim sentences', () => {
    const ms = [{ role: 'char', data: prev1 }]
    it('guide sentences and scene sentences', () => {
        const v = verbatimAvoid(ms, 'Hana')
        expect(v.guide).toContain('Cậu muốn tớ nhìn qua bên kia không?')
        expect(v.scene).toContain('Tiếng cào ngoài hành lang ngừng hẳn.')
        expect(verbatimAvoid(ms, '').guide).toEqual([])
        expect(verbatimAvoid(Array.from({ length: 3 }, (_, i) => ({ role: 'char', data: Array.from({ length: 5 }, (_, j) => `Câu cảnh số ${i} thứ ${j} dài đủ chữ.`).join(' ') })), 'Hana').scene).toHaveLength(8)
    })
    it('directive and guideNote carry the rules', () => {
        const d = guideNote({ globalLore: [{ comment: 'Story guide: Hana' }] }, ms, 'x', 0)
        expect(d).toContain('do not reuse these sentences verbatim:')
        expect(d).toContain('"Cậu muốn tớ nhìn qua bên kia không?"')
        expect(d).toContain('may repeat only when a value changed')
        expect(guideDirective({ present: true, name: 'Hana', playerText: '', turnsWithoutProgress: 0, recentLines: [], asked: false })).not.toContain('verbatim')
        expect(alreadyTold(ms, 'Hana').length).toBeGreaterThan(0)
    })
})


describe('settleReply records what fired', () => {
    it('records the rules that fired and what is left after the one redo', async () => {
        const { settleReply } = await import('./replyRegen')
        const prev = ['Tiếng cào ngoài hành lang ngừng hẳn rồi.']
        const rec: any[] = []
        const out = await settleReply('Tiếng cào ngoài hành lang ngừng hẳn rồi.', prev, async () => 'Kenji áp tai vào cửa lạnh ngắt.', () => {}, (r) => rec.push(r))
        expect(out).toBe('Kenji áp tai vào cửa lạnh ngắt.')
        expect(rec).toEqual([{ fired: ['repeat'], left: [], redoFailed: false, redos: 1 }])
    })
    it('records nothing for a clean reply and a failed redo as such', async () => {
        const { settleReply } = await import('./replyRegen')
        const rec: any[] = []
        await settleReply('Kenji áp tai vào cửa lạnh ngắt.', ['Gió thổi qua khe cửa sổ mở hé.'], async () => 'x', () => {}, (r) => rec.push(r))
        expect(rec).toEqual([])
        await settleReply('Tiếng cào ngoài hành lang ngừng hẳn rồi.', ['Tiếng cào ngoài hành lang ngừng hẳn rồi.'], async () => null, () => {}, (r) => rec.push(r))
        expect(rec[0].redoFailed).toBe(true)
    })
})

describe('repeated dialogue (a real gate: the companion said the same line again 3 to 8 turns later)', () => {
    const said = 'Evelyn nghiêng đầu. “Tớ không thấy dấu chân rõ hơn đâu.” Cô lùi nửa bước.'
    const filler = (i: number) => `Kenji đi thêm ${i} bước dọc hành lang và nghe mưa gõ lên mái.`
    const history = [said, filler(1), filler(2), filler(3), filler(4)]
    const again = 'Cô khẽ cười. “tớ KHÔNG thấy dấu chân rõ hơn đâu!” Rồi cô quay đi.'

    it('a line said word for word 4 replies ago (case, quotes, punctuation folded) is a dialogue hit', () => {
        expect(dialogueRepeats(again, history)).toEqual(['tớ KHÔNG thấy dấu chân rõ hơn đâu!'])
        expect(replyHits(again, history).map((h) => h.rule)).toEqual(['dialogue'])
    })
    it('older than 8 replies, or different words, or a short line: no hit', () => {
        const old = [said, ...Array.from({ length: 8 }, (_, i) => filler(i))]
        expect(dialogueRepeats(again, old)).toEqual([])
        expect(replyHits('Cô nói. “Tớ thấy một vết giày rõ hơn nhiều.”', history)).toEqual([])
        expect(dialogueRepeats('“Im đi nào.”', ['“Im đi nào.”'])).toEqual([])
    })
    it('the redo note names the line: đừng lặp câu đã nói', () => {
        expect(regenerationNote(replyHits(again, history))).toContain('đừng lặp câu đã nói: "tớ KHÔNG thấy dấu chân rõ hơn đâu!"')
    })
    it('settleReply redoes once for it and records which check fired', async () => {
        const rec: { fired: string[] }[] = []
        const notes: string[] = []
        const out = await settleReply(again, history, async (n) => { notes.push(n); return 'Kenji im lặng. “Nghe kìa, có tiếng gì dưới thang máy.”' }, () => {}, (r) => rec.push(r))
        expect(out).toContain('thang máy')
        expect(notes).toHaveLength(1)
        expect(rec[0].fired).toEqual(['dialogue'])
    })
    it('what the acceptance scorer calls a repeat between consecutive replies is a hit in the app (same definition)', () => {
        const prev = 'Cô nói. “Tớ nghe thấy tiếng cào ở ngoài cánh cửa này rồi.”'
        const cur = 'Cô nhắc lại. “Tớ nghe thấy tiếng cào ngoài cánh cửa này đấy.”'
        expect(consecutiveRepeat(cur, prev)).not.toBeNull()
        expect(narrationProblems([prev, cur]).map((p: { rule: string }) => p.rule)).toContain('repeat')
        expect(replyHits(cur, [prev]).map((h) => h.rule)).toContain('repeat')
        const other = 'Cô nói. “Mưa đã nhẹ đi, mình đi tiếp thôi chứ.”'
        expect(consecutiveRepeat(other, prev)).toBeNull()
        expect(narrationProblems([prev, other]).filter((p: { rule: string }) => p.rule === 'repeat')).toEqual([])
        expect(replyHits(other, [prev])).toEqual([])
    })
})

describe('language drift (a real gate: the narrator answered a story turn in French, g4.15)', () => {
    // the real reply: French narration around Vietnamese speech, with the tags the app strips
    const FRENCH = 'Kenji se repose sans quitter la pièce des oreilles. La pluie couvre les petits bruits du bâtiment, mais pas tous : quelque part dans les tuyaux, une vibration sourde revient par à-coups, puis s’interrompt. Derrière la porte, rien ne gratte. Le silence n’est pas rassurant ; il laisse juste moins de choses à compter.\n\nÀ côté du téléphone, un écouteur filaire noir s’est coincé sous le bord de la table. Le câble est emmêlé, mais la prise semble intacte. Un vieux modèle, sans batterie ni magie : s’il reste assez de charge au téléphone, il pourrait aider à écouter sans tenir l’appareil contre l’oreille.\n\nEvelyn incline la tête vers la cloison mitoyenne. “Có tiếng rung trong ống nước… hình như ở dưới tầng. Tớ không biết nó từ đâu tới.” Cô nhìn cánh cửa căn hộ rồi khẽ nhíu mày. “Chỗ này yên quá.”\n\n[💡Kế hoạch| Không ]\n\n[[FIND|item|Tai nghe có dây|Wired Earbuds|Có thể nối với điện thoại còn pin.|common|Chỉ dùng được khi điện thoại còn pin.|yes]]\n\n[[ACT|lang-nghe-trong-luc-nghi|cam_nhan|normal||giữ-im-lặng]]'
    const EN_SHORT = 'Kenji pushes the door shut with his shoulder and waits in the dark. The stairwell is quiet, and the rain on the window is the only sound he can hear in the room.'
    const EN_NAMES = 'Hoshin Park crosses the lobby of the Kisaragi building and stops at the mailboxes, where Evelyn is already reading a letter that is not hers. Neither of them says anything about it.'
    const FR_SHORT = 'Evelyn ne répond pas. Kenji entend la pluie contre la vitre et attend, la main sur la poignée, que le couloir se taise enfin.'
    const ES = 'Kenji se acerca a la ventana y mira la calle vacía. La lluvia golpea el cristal y, detrás de la puerta, el pasillo sigue en silencio como si nadie hubiera pasado por allí.'
    const ES_NAMES = 'Evelyn cruza la habitación sin hacer ruido y se sienta junto a Kenji, que no deja de mirar el teléfono mientras espera una señal que no llega.'
    const MIXED = 'Kenji hít một hơi rồi khẽ nói: “C’est bon, on y va.” Evelyn nghiêng đầu nhìn anh, hỏi bằng giọng rất nhỏ rằng anh vừa nói gì. Anh lắc đầu, bảo đó chỉ là một câu tiếng Pháp mà bà chủ nhà hay nói mỗi khi trời mưa, và bước ra hành lang, tay vẫn giữ chặt cán dao.'

    it('French, English and Spanish narration is flagged; the French turn from the gate most of all', () => {
        for (const t of [FRENCH, EN_SHORT, EN_NAMES, FR_SHORT, ES, ES_NAMES]) {
            expect(languageHits(t), t.slice(0, 40)).toHaveLength(1)
            expect(replyHits(t, []).map((h) => h.rule)).toContain('lang')
        }
        const d = languageDrift(FRENCH)
        expect(d.viet).toBeLessThan(0.1)
        expect(d.foreign).toBeGreaterThan(0.2)
    })
    it('Vietnamese narration is not flagged, even with a short foreign phrase inside', () => {
        expect(replyHits(MIXED, [])).toEqual([])
        expect(replyHits('Kenji mở tin nhắn trên Messenger, đọc dòng “OK, see you tonight” rồi cất điện thoại vào túi. Evelyn hỏi anh định đi đâu vào giờ này.', [])).toEqual([])
        expect(languageHits('Evelyn nghiêng đầu.')).toEqual([])
        expect(languageHits('Kenji.')).toEqual([])
    })
    it('a sample of the real Vietnamese corpus (48 replies, 991 distinct measured): none flagged', () => {
        expect(viReplies.length).toBeGreaterThan(40)
        const flagged = (viReplies as string[]).filter((t) => languageDrift(t).drift)
        expect(flagged).toEqual([])
        expect((viReplies as string[]).filter((t) => replyHits(t, []).some((h) => h.rule === 'lang'))).toEqual([])
    })
    it('the regeneration note asks, hidden, for Vietnamese', () => {
        const hits = replyHits(FRENCH, [])
        expect(regenerationNote(hits)).toContain('trả lời bằng tiếng Việt')
        expect(shouldRegenerate(hits, 0)).toBe(true)
    })
    it('settleReply redoes a French draft once and records the lang rule', async () => {
        const notes: string[] = []
        const recs: { fired: string[]; left: string[]; redoFailed: boolean }[] = []
        const vi = 'Kenji nằm yên, lắng nghe tiếng mưa rơi ngoài cửa sổ. Hành lang vẫn im lặng, không có tiếng cào nào nữa.'
        const out = await settleReply(FRENCH, [], async (n) => { notes.push(n); return vi }, () => {}, (r) => recs.push(r))
        expect(out).toBe(vi)
        expect(notes).toHaveLength(1)
        expect(notes[0]).toContain('trả lời bằng tiếng Việt')
        expect(recs).toEqual([{ fired: ['lang', 'tag'], left: [], redoFailed: false, redos: 1 }])   // the real French reply also had a malformed [[ACT…]] (a fifth field)
    })
    it('the gate scorer flags it through the same function (narration.clean)', () => {
        const vi = 'Kenji nắm chặt cán dao và đếm nhịp thở của mình. Ngoài hành lang, tiếng mưa che khuất mọi âm thanh nhỏ.'
        expect(narrationProblems([vi, FRENCH.split('[💡')[0]]).map((p: { rule: string }) => p.rule)).toEqual(['lang'])
        expect(narrationProblems([vi, MIXED])).toEqual([])
    })
})


// Real scene-sentence repeats from the w5c gate runs (2026-11-04): the scorer flagged each (a sentence of the reply at >= 90% of one in the
// previous reply) and the app never fixed them, because it only looked at exact repeats and at spoken lines.
describe('scene sentence repeats the scorer reports', () => {
    const REAL: [string, string, string][] = [
        ['evelyn run 3 turn 2', 'Tớ không biết ngoài kia có chuyện gì, nhưng vừa rồi có tiếng kéo lê ngay ngoài cửa.”', 'Kenji áp tai vào cửa. Ngoài cửa không có thêm tiếng động. Anh thở ra.'],
        ['evelyn run 3 turn 16', 'Tiếng mưa bên ngoài đã thưa đi, còn trong tòa nhà chỉ còn những âm thanh nhỏ truyền qua bê tông: tiếng ống nước co lại, một tiếng cộc trầm phía dưới, rồi im.', 'Có tiếng rền dưới sàn. Sau tiếng rền, tòa nhà lại im. Kenji đếm đến mười.'],
        ['evelyn run 4 turn 2', 'Ngoài cửa, hành lang im lặng, nhưng dưới khe cửa vẫn luồn vào một vệt mùi tanh lẫn với mùi thuốc tẩy cũ.', 'Mùi tanh vẫn len dưới khe cửa. Kenji lùi một bước.'],
        ['default run 5 turn 2', 'Đường ra ngoài nằm ngay bên kia cánh cửa; căn hộ vẫn còn những thứ có thể dùng, nhưng tiếng cọ ngoài kia lại vang lên lần nữa, gần hơn một chút.', 'Cô hạ giọng. “Ngoài cửa với bên kia tường.” Rồi im.'],
    ]
    for (const [name, prev, cur] of REAL) {
        it(`${name}: the scorer flags it and the app check now does too`, () => {
            expect(narrationProblems([prev, cur]).map((p) => p.rule)).toContain('repeat')
            expect(consecutiveSceneRepeat(cur, prev)).not.toBeNull()
            expect(replyHits(cur, [prev]).map((h) => h.rule)).toEqual(['scene'])
        })
    }
    it('the note for it is "đừng lặp câu đã nói", and a regeneration clears it', async () => {
        const [, prev, cur] = REAL[0]
        const hits = replyHits(cur, [prev])
        expect(regenerationNote(hits)).toContain('đừng lặp câu đã nói: "Ngoài cửa không có thêm tiếng động."')
        expect(await settleReply(cur, [prev], async () => 'Kenji nghe nhịp thở của chính mình, rồi nhìn xuống đôi giày.')).toBe('Kenji nghe nhịp thở của chính mình, rồi nhìn xuống đôi giày.')
    })
    it('System lines stay out of it, an unrelated sentence does not hit', () => {
        const sys = '【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3 | Nước 2 | Ngày 1】'
        expect(consecutiveSceneRepeat(`Kenji thở ra.\n${sys}`, `Anh đứng im.\n${sys}`)).toBeNull()
        expect(consecutiveSceneRepeat(REAL[0][2], 'Một con quạ đen đậu trên lan can và nhìn xuống sân.')).toBeNull()
    })
})

describe('malformed growth tags (rule "tag")', () => {
    const body = 'Kenji leo lên bậc thang cuối, hơi thở dồn lại ở cổ họng.'
    it('the two real lines without the first pipe are hits, the right form is not', () => {
        for (const t of ['[[ACT leo-cầu-thang|the_luc+cam_nhan|normal|]]', '[[ACT dọn-chỗ-nấp|suc_manh+cam_nhan|trivial|]]']) {
            expect(replyHits(`${body}\n${t}`, []).map((h) => h.rule)).toEqual(['tag'])
        }
        for (const t of ['[[ACT|leo-cầu-thang|the_luc+cam_nhan|normal|]]', '[[ACT|x|Sức mạnh + Ý chí|hard|giữ-im-lặng]]', '[[BREAK|y_chi]]']) {
            expect(replyHits(`${body}\n${t}`, [])).toEqual([])
        }
    })
    it('unknown stat, wrong field count, unclosed, mixed case', () => {
        for (const t of ['[[ACT|nghe-ngóng|cảm_nhận|normal|]]', '[[ACT|nghe|cam_nhan|normal||giữ-im-lặng]]', '[[ACT|nghe|cam_nhan|normal]]', '[[ACT|nghe|cam_nhan|normal|', '[[act|nghe|cam_nhan|normal|]]', '[[BREAK y_chi]]', '[[BREAK|magic]]']) {
            expect(tagWellFormed(t)).toBe(false)
            expect(malformedTags(`${body} ${t}`)).toHaveLength(1)
        }
    })
    it('the note asks for the right form; the regeneration is recorded as rule tag', async () => {
        const dirty = `${body}\n[[ACT leo-cầu-thang|the_luc+cam_nhan|normal|]]`
        expect(regenerationNote(replyHits(dirty, []))).toContain('[[ACT|id|stat|độ khó|skill]] hoặc bỏ thẻ')
        const rec: { fired: string[] }[] = []
        await settleReply(dirty, [], async () => `${body}\n[[ACT|leo-cầu-thang|the_luc|normal|]]`, () => {}, (r) => rec.push(r))
        expect(rec[0].fired).toEqual(['tag'])
    })
})

describe('the global interface line is 【ADMIN: …】 as well as 【HỆ THỐNG: …】 (owner renamed the interface card to Admin)', () => {
    const admin = '【ADMIN: Tình trạng ổn định | Điểm sinh tồn 12/20 | Thức ăn 3 | Nước 2 | Ngày 1】'
    const prev = `Tiếng cào ngoài hành lang ngừng hẳn. Hana ngồi sát cửa.\n${admin}`
    it('an unchanged ADMIN line repeated is the system rule, never a repeated sentence or scene', () => {
        const cur = `Kenji nắm chặt cán dao và đếm nhịp thở của mình.\n${admin}`
        expect(verbatimRepeats(cur, [prev])).toEqual([])
        expect(consecutiveSceneRepeat(cur, prev)).toBeNull()
        expect(systemLineRepeats(cur, [prev])).toEqual([admin])
        expect(replyHits(cur, [prev]).map((h) => h.rule)).toEqual(['system'])
        expect(replyHits(admin, ['【ADMIN:   Tình trạng ổn định | Điểm sinh tồn 12/20 | Thức ăn 3 | Nước 2 | Ngày 1】']).map((h) => h.rule)).toEqual(['system'])
    })
    it('a changed ADMIN line is fine', () => {
        const cur = 'Kenji nắm chặt cán dao và đếm nhịp thở của mình.\n【ADMIN: Tình trạng ổn định | Điểm sinh tồn 12/20 | Thức ăn 3 | Nước 2 | Ngày 2】'
        expect(replyHits(cur, [prev])).toEqual([])
    })
    it('narration extraction drops the ADMIN line, as it drops a HỆ THỐNG one', () => {
        expect(narrationOf(`Kenji thở ra.\n${admin}`)).not.toContain('ADMIN')
        expect(narrationOf('Kenji thở ra.\n【HỆ THỐNG: Ngày 1】')).not.toContain('HỆ THỐNG')
        expect(narrationOf('Kenji thở ra.\n  【 ADMIN: Ngày 1】')).not.toContain('ADMIN')
    })
    it('the guide directive names both forms', () => {
        const d = guideDirective({ present: true, name: 'Admin', asked: false, turnsWithoutProgress: 0, recentLines: [] } as any)
        expect(d).toContain('【ADMIN…】')
        expect(d).toContain('【HỆ THỐNG…】')
    })
})
