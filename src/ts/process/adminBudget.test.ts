// @vitest-environment node
// Admin's token cap (owner 2026-11-13: at most 4,000 real o200k tokens per request, no rule dropped): the estimator never counts below the real
// tokenizer, every turn kind fits the cap and carries the sections it needs, every section is reachable, nothing is sent twice, and the
// persona record shows each stat with its band. The texts are the five cards' real payloads (__fixtures__/admin/payload_<card>.json, made with
// tools/assets shared_assets.global_for_card from shared/characters/admin.md and shared/_roles/guide.md); set ADMIN_TABLE=1 to print the table.
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { adminBlock, BAND_WORDS, ADMIN_BOOT, fitBudget, personaRecordText, statBand, RECORD_TITLE, RECORD_SKILLS_MAX, recordScope, withEquipped, type AdminPayload } from './adminGlobal'
import { ADMIN_TOKEN_CAP, SECTION_RULES, TRIGGERS, estimateTokens, headingKey, turnFacts, type Trigger } from './adminSections'
import { buildView } from './personaStats'

const require = createRequire(import.meta.url)
const { get_encoding } = require('@dqbd/tiktoken')
const enc = get_encoding('o200k_base')
const real = (s: string): number => enc.encode(s).length

const CARDS = ['zombie', 'mailman', 'lotm', 'shadow-slave', 'cha-test'] as const
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '__fixtures__', 'admin')
const payloadOf = (card: string): AdminPayload => JSON.parse(fs.readFileSync(path.join(dir, `payload_${card}.json`), 'utf8'))

// persona record samples: a fresh persona, a grown one, every band, the empty store
const FRESH = { stats: {}, skills: {} } as never
const GROWN = { stats: { the_luc: 1612, nhanh_nhen: 2150, suc_manh: 4400, cam_nhan: 6100, tinh_than: 8200, y_chi: 10000 }, skills: { 'wall-vibration-listening': 4, 'iron-fist': 90 } }
const names = { 'wall-vibration-listening': { vi: 'Nghe rung vách' }, 'iron-fist': { vi: 'Thiết quyền' } }
const records = (): Record<string, string> => ({
    freshWords: personaRecordText(buildView(FRESH, undefined, names), 'Kenji Park', 'words'),
    grownWords: personaRecordText(buildView(GROWN, undefined, names), 'Kenji Park', 'words'),
    grownNumbers: personaRecordText(buildView(GROWN, undefined, names), 'Kenji Park', 'numbers'),
    none: personaRecordText({ source: 'none', stats: [], slots: { used: 0, total: 0 }, skills: [] }, 'Kenji Park'),
})

describe('estimateTokens never counts below the real o200k tokens', () => {
    it('whole texts: the five cards\' Admin text and the persona record samples, real <= estimate <= 1.25 x real', () => {
        const texts: Record<string, string> = { ...records() }
        for (const c of CARDS) texts[c] = payloadOf(c).assets.map((a) => `[${a.title}]\n${a.body}`).join('\n\n')
        for (const [k, t] of Object.entries(texts)) {
            const r = real(t), e = estimateTokens(t)
            expect(e, `${k}: estimate ${e} below real ${r}`).toBeGreaterThanOrEqual(r)
            expect(e, `${k}: estimate ${e} over 1.25 x real ${r}`).toBeLessThanOrEqual(r * 1.25)
        }
    })
    it('every section of every card is also never under-counted', () => {
        for (const c of CARDS) for (const a of payloadOf(c).assets) for (const sec of a.body.split(/\n(?=## )/)) {
            expect(estimateTokens(sec), `${c}: ${sec.slice(0, 30)}`).toBeGreaterThanOrEqual(real(sec))
        }
    })
    it('Vietnamese prose, numbers, symbols and emoji are not under-counted either', () => {
        for (const t of ['Chỉ số: Thể lực: cao nhất, khá hơn các chỉ số khác, bậc Thường; Ý chí: thấp nhất', '10.15% +0.01 3.00 KHÁCH-704 d20', '【ADMIN: Nhiệm vụ — tìm lối ra khỏi làng.】 🛡 Admin', '[[TRAIN|the_luc+nhanh_nhen|manh]] [[FOE|Lê Vương|huyền thoại]]']) {
            expect(estimateTokens(t), t).toBeGreaterThanOrEqual(real(t))
        }
    })
})

// ---- turn kinds -------------------------------------------------------------------------------------------------------------------

type Msg = { role: string; data: string }
const chat = (player: string, extra = ''): { messages: Msg[]; formated: { role: string; content: string }[] } => ({
    messages: [{ role: 'char', data: 'Cánh cửa kẽo kẹt. Gió lùa qua hành lang tối.' }, { role: 'user', data: player }],
    formated: [{ role: 'system', content: 'main' }, { role: 'user', content: player + extra }],
})
const KINDS: Record<string, { opening?: boolean; player: string; extra?: string; findDue?: boolean; vars?: Record<string, unknown>; needs: string[] }> = {
    first: { opening: true, player: 'bắt đầu', needs: ['Connecting', 'Standing duties', 'Persona record'] },
    ordinary: { player: 'tôi mở cửa bước vào', needs: ['Standing duties', 'Stat scale', 'Training'] },
    ask: { player: '@admin giờ tôi nên làm gì?', extra: '\n\n[ADMIN HỎI ĐÁP (ẩn). Trả lời ngoài truyện.]', needs: ['Asking Admin outside the story'] },
    review: { player: 'tôi mở cửa bước vào', extra: '\n\n[GM xem lại: lặp cảnh.]', needs: ['Asking Admin outside the story'] },
    fight: { player: 'tôi chém hắn', needs: ['Defeats'] },
    fightMode: { player: 'tôi lùi lại', vars: { $gm_mode: JSON.stringify({ at: 0, mode: { scene: 'still', combat: 'fight' }, prev: null }) }, needs: ['Defeats'] },
    find: { player: 'tôi mở cửa bước vào', extra: '\n\n[Find (hidden, never named): a bronze item is due in this reply.]', needs: ['Finds'] },
    findDue: { player: 'tôi mở cửa bước vào', findDue: true, needs: ['Finds'] },
    help: { player: 'giúp tôi với, tôi bí rồi', needs: ['Guide: hints'] },
    record: { player: 'cho tôi xem chỉ số và kỹ năng', needs: ['Persona record'] },
    scout: { player: 'Admin quét quanh đây', needs: ['Scouting'] },
    loadout: { player: 'đổi trang bị kỹ năng', needs: ['Loadout advice'] },
    mission: { player: 'nhiệm vụ của tôi, còn bao nhiêu điểm tem', needs: ['Missions, stamps and points', 'Quests'] },
    learn: { player: 'tôi đã học được gì vì sao thay đổi', needs: ['Reading what he learned'] },
    questEvent: { player: 'tôi nhìn quanh', extra: '\n\n[Nhiệm vụ (ẩn, không gọi là «nhiệm vụ»): tìm nước.]', needs: ['Quests', 'Admin hands out quests on its own'] },
    questGm: { player: 'tôi nhìn quanh', extra: '\n\n[Admin cần giao 1 mission. Rút mission TỪ mạch truyện.]', needs: ['Quests', 'Admin hands out quests on its own'] },
    questSkip: { player: 'bỏ qua nhiệm vụ này', needs: ['Admin hands out quests on its own'] },
}
const factsOf = (k: (typeof KINDS)[string]) => {
    const c = chat(k.player, k.extra)
    return turnFacts({ opening: !!k.opening, formated: c.formated, messages: k.opening ? [{ role: 'user', data: k.player }] : c.messages, vars: k.vars, findDue: k.findDue })
}
const keysOf = (p: AdminPayload) => p.assets.flatMap((a) => a.body.split(/\n(?=## )/).map((c) => headingKey(c.startsWith('## ') ? c.split('\n', 1)[0] : ''))).filter(Boolean)
const RECORD = records().grownWords
const REC_STYLE = (c: string) => (c === 'cha-test' ? records().grownNumbers : RECORD)
const build = (c: string, kind: string, cap: number) => {
    const k = KINDS[kind]
    const logs: string[] = []
    const text = adminBlock(payloadOf(c), { user: 'Kenji', opening: !!k.opening, record: REC_STYLE(c), facts: factsOf(k), cap, log: (m) => logs.push(m) })
    return { text, logs }
}

describe('every turn kind fits the cap (4,000 real tokens) and carries what it needs', () => {
    it('real cap: every card x every turn kind is <= 4000 real tokens, estimate <= cap, and nothing is held back or cut', () => {
        const rows: string[] = []
        for (const c of CARDS) {
            const cells: string[] = []
            for (const kind of Object.keys(KINDS)) {
                const { text, logs } = build(c, kind, ADMIN_TOKEN_CAP)
                const r = real(text)
                expect(r, `${c}/${kind}: ${r} real tokens`).toBeLessThanOrEqual(4000)
                expect(estimateTokens(text), `${c}/${kind}`).toBeLessThanOrEqual(ADMIN_TOKEN_CAP)
                expect(logs, `${c}/${kind} was cut`).toEqual([])
                for (const need of KINDS[kind].needs) if (keysOf(payloadOf(c)).includes(need)) expect(text, `${c}/${kind} lacks ${need}`).toContain(payloadOf(c).assets.flatMap((a) => a.body.split(/\n(?=## )/)).find((s) => headingKey(s.split('\n', 1)[0]) === need)!.slice(0, 60))
                cells.push(`${kind}=${r}`)
            }
            rows.push(`${c.padEnd(13)} ${cells.join(' ')}`)
        }
        if (process.env.ADMIN_TABLE) fs.appendFileSync(process.env.ADMIN_TABLE, `cap ${ADMIN_TOKEN_CAP}\n${rows.join('\n')}\n`)
    })

    // when the whole text would not fit, each turn gets only what it needs: shown with a cap that is under the full text
    const TIGHT = 2900
    const tightRows: string[] = []
    it('under a tighter cap the per-turn selection holds sections back, still fits, and keeps what the turn needs', () => {
        for (const c of CARDS) {
            const keys = keysOf(payloadOf(c))
            for (const kind of Object.keys(KINDS)) {
                const { text, logs } = build(c, kind, TIGHT)
                expect(real(text), `${c}/${kind}`).toBeLessThanOrEqual(TIGHT)
                tightRows.push(`${c} ${kind}=${real(text)}`)
                expect(logs, `${c}/${kind}: a needed section was cut`).toEqual([])
                for (const need of KINDS[kind].needs) {
                    if (!keys.includes(need)) continue
                    const body = payloadOf(c).assets.flatMap((a) => a.body.split(/\n(?=## )/)).find((s) => headingKey(s.split('\n', 1)[0]) === need)!
                    expect(text, `${c}/${kind} lacks ${need}`).toContain(body.slice(0, 60))
                }
                if (kind !== 'ask' && kind !== 'review') expect(text, `${c}/${kind} lacks the Stat scale`).toContain('Stats run 1-100')
                expect(text).toContain(RECORD_TITLE)
            }
        }
    })
    it('prints the tight-cap table when asked', () => {
        if (process.env.ADMIN_TABLE) fs.appendFileSync(process.env.ADMIN_TABLE, `cap ${TIGHT}\n${tightRows.join('\n')}\n`)
    })
    it('an ordinary turn does not carry the sections that are only for other turns', () => {
        for (const c of CARDS) {
            const t = build(c, 'ordinary', 2900).text
            for (const only of ['Asking Admin outside the story', 'Connecting', 'Defeats', 'Finds']) {
                const sec = payloadOf(c).assets.flatMap((a) => a.body.split(/\n(?=## )/)).find((s) => headingKey(s.split('\n', 1)[0]) === only)
                if (sec) expect(t, `${c} ordinary carries ${only}`).not.toContain(sec.slice(0, 60))
            }
        }
    })
    it('cuts by the stated priority when a turn is over even after the selection; the intro, TRAIN rules and the record block never go', () => {
        const p = payloadOf('mailman')
        const rec = records().grownWords
        const r = fitBudget(p.assets, { cap: 1200, record: rec, facts: factsOf(KINDS.first) })
        expect(r.cut.length).toBeGreaterThan(0)
        const dropOrder = Object.entries(SECTION_RULES).filter(([, v]) => v.cut !== null).sort((a, b) => (a[1].cut as number) - (b[1].cut as number)).map(([k]) => k)
        const idx = r.cut.map((k) => dropOrder.indexOf(k))
        expect(idx.every((i) => i >= 0)).toBe(true)
        expect([...idx].sort((a, b) => a - b)).toEqual(idx)
        for (const keep of ['Admin is the server-side manager', '[[TRAIN|the_luc+nhanh_nhen|manh]]', RECORD_TITLE, 'Stats run 1-100']) expect(r.text).toContain(keep)
        for (const k of r.cut) expect(SECTION_RULES[k].cut).not.toBeNull()
    })
})

describe('sections: reachable, once, and in the table', () => {
    it('every heading of every card has a row in SECTION_RULES, and every sendable section is reached by some turn kind', () => {
        const reached = new Set<string>()
        for (const c of CARDS) for (const key of keysOf(payloadOf(c))) {
            expect(SECTION_RULES, `${c}: heading "${key}" has no row`).toHaveProperty(key)
            const rule = SECTION_RULES[key]
            if (rule.on === 'always') { reached.add(key); continue }
            const hit = Object.entries(KINDS).some(([, k]) => { const f = factsOf(k); return rule.on.some((t: Trigger) => f.has(t)) && !rule.off?.some((t) => f.has(t)) })
            expect(hit, `${c}: no turn kind sends "${key}"`).toBe(true)
            reached.add(key)
        }
        // every trigger is fired by some turn kind
        const fired = new Set<string>()
        for (const k of Object.values(KINDS)) factsOf(k).forEach((t) => fired.add(t))
        for (const t of TRIGGERS) expect(fired.has(t), `trigger ${t} is never fired`).toBe(true)
    })
    it('nothing is sent twice: each section, the record, the framing and the boot line appear once', () => {
        for (const c of CARDS) for (const kind of ['first', 'ask', 'fight', 'ordinary']) {
            const { text } = build(c, kind, ADMIN_TOKEN_CAP)
            const secs = payloadOf(c).assets.flatMap((a) => a.body.split(/\n(?=## )/)).map((s) => s.trim().slice(0, 80))
            for (const s of secs) expect(text.split(s).length - 1, `${c}/${kind}: "${s.slice(0, 30)}"`).toBe(1)
            expect(text.match(new RegExp('^' + RECORD_TITLE.replace(/[()\[\]]/g, '\\$&'), 'gm'))).toHaveLength(1)
            expect(text.split('[Admin (global interface rules').length - 1).toBe(1)
            expect(text.split('[Admin boot').length - 1).toBe(kind === 'first' ? 1 : 0)
        }
        expect(ADMIN_BOOT).not.toContain('standing duties')
    })
})

describe('the persona record shows each stat with its band', () => {
    it('band = min(5, floor(points / 20) + 1), points = hundredths / 100 clamped to 1..100', () => {
        const cases: [number, number][] = [[0, 1], [100, 1], [1000, 1], [1999, 1], [2000, 2], [3999, 2], [4000, 3], [5999, 3], [6000, 4], [7999, 4], [8000, 5], [10000, 5], [99999, 5]]
        for (const [h, b] of cases) expect(statBand(h), String(h)).toBe(b)
        expect([...BAND_WORDS]).toEqual(['Thường', 'Tinh anh', 'Thủ lĩnh', 'Huyền thoại', 'Thần'])
    })
    it('words style: a band word beside each stat and still no digit in the stats line; numbers style: values plus the band word', () => {
        const r = records()
        const stats = r.grownWords.split('\n').find((l) => l.startsWith('Chỉ số:'))!
        expect(stats).toMatch(/Thể lực: [^;]*bậc Thường/)
        expect(stats).toMatch(/Nhanh nhẹn: [^;]*bậc Tinh anh/)
        expect(stats).toMatch(/Sức mạnh: [^;]*bậc Thủ lĩnh/)
        expect(stats).toMatch(/Cảm nhận: [^;]*bậc Huyền thoại/)
        expect(stats).toMatch(/Tinh thần: [^;]*bậc Thần/)
        expect(stats).toMatch(/Ý chí: cao nhất[^;]*bậc Thần/)
        expect(stats).not.toMatch(/\d/)
        expect(r.grownNumbers).toMatch(/Thể lực 16 \(EXP[^)]*\) \(bậc Thường\)/)
        expect(r.grownNumbers).toContain('(bậc Thần)')
        expect(r.none).not.toMatch(/bậc|\d/)
    })
})

// Measured 2026-11-13 (Z3 + Alloy + the real fitBudget): the record is never cut and its skill list had no limit, so a persona with
// 80 skills pushed the block past the cap on every card (shadow-slave: 79 skills = 3999, 80 = 4026), 300 skills = ~10000.
describe('the persona record is bounded, so the block stays inside the cap whatever the store holds', () => {
    const many = (k: number) => {
        const skills: Record<string, number> = {}
        const finds: Record<string, { vi: string }> = {}
        for (let i = 0; i < k; i++) { skills['sk' + i] = 300 + i * 7; finds['sk' + i] = { vi: 'Kiếm thuật Hắc Ảnh bậc ' + (i + 1) } }
        return buildView({ stats: { suc_manh: 420, y_chi: 900 }, skills } as never, undefined, finds)
    }
    it('lists at most RECORD_SKILLS_MAX skills (the equipped and the strongest first) and says how many are left out', () => {
        for (const style of ['numbers', 'words'] as const) {
            const t = personaRecordText(many(300), 'Kenji Park', style)
            const line = t.split('\n').find((l) => l.startsWith('Kỹ năng:'))!
            expect(line.split('; ').length, style).toBe(RECORD_SKILLS_MAX + 1)
            expect(line, style).toContain('Kiếm thuật Hắc Ảnh bậc 300')        // the strongest stays
            expect(line, style).not.toContain('Kiếm thuật Hắc Ảnh bậc 1 (')     // the weakest is left out
            expect(line, style).toMatch(/kỹ năng khác thấp hơn/)
        }
        expect(personaRecordText(many(300), 'Kenji Park', 'numbers')).toContain(`và ${300 - RECORD_SKILLS_MAX} kỹ năng khác thấp hơn`)
        expect(personaRecordText(many(RECORD_SKILLS_MAX), 'Kenji Park')).not.toMatch(/kỹ năng khác thấp hơn/)
    })
    it('300 skills: every card, first reply and plain turn, stays inside ADMIN_TOKEN_CAP', () => {
        for (const c of CARDS) for (const style of ['numbers', 'words'] as const) for (const opening of [true, false]) {
            const record = personaRecordText(many(300), 'Kenji Park', style)
            const facts = new Set(opening ? ['opening'] : []) as never
            const r = fitBudget(payloadOf(c).assets, { record, facts, extra: '[Admin (global interface rules, hidden, never quoted)]\n' + (opening ? '\n\n' + ADMIN_BOOT : '') })
            expect(r.tokens, `${c} ${style} ${opening}`).toBeLessThanOrEqual(ADMIN_TOKEN_CAP)
        }
    })
})

// Owner 2026-11-13: the slot rule already bounds what is in use, so a plain turn carries the skills in slots only; the learned-but-not-
// equipped ones show when the player asks for the record, asks Admin, changes the loadout, and on the first reply.
describe('the record on a plain turn lists the skills in slots only', () => {
    const view = (eq: number) => {
        const sk: Record<string, { m: number; eq?: number; name: string }> = {}
        for (let i = 0; i < 20; i++) sk['s' + i] = { m: 300 + i * 10, name: 'Kỹ năng số ' + (i + 1), ...(i < eq ? { eq: 1 } : {}) }
        return buildView({ stats: { y_chi: 9000 }, skills: {} } as never, { $skills: JSON.stringify(sk) } as never)
    }
    it('equipped scope: the equipped ones by name, the rest as one count with how to see them', () => {
        for (const style of ['numbers', 'words'] as const) {
            const line = personaRecordText(view(3), 'Kenji Park', style, 'equipped').split('\n').find((l) => l.startsWith('Kỹ năng'))!
            expect(line, style).toContain('Kỹ năng số 1 (')
            expect(line, style).toContain('Kỹ năng số 3 (')
            expect(line, style).not.toContain('Kỹ năng số 20 (')
            expect(line, style).toMatch(/đã học nhưng chưa gắn/)
        }
        expect(personaRecordText(view(3), 'Kenji Park', 'numbers', 'equipped')).toContain('17 kỹ năng đã học nhưng chưa gắn')
        expect(personaRecordText(view(3), 'Kenji Park', 'numbers', 'all')).toContain('Kỹ năng số 20 (')
        expect(personaRecordText(view(3), 'Kenji Park')).toContain('Kỹ năng số 20 (')            // the default stays the whole list
    })
    it('nothing equipped (a story with no slots of its own): the strongest six stand in', () => {
        const line = personaRecordText(view(0), 'Kenji Park', 'numbers', 'equipped').split('\n').find((l) => l.startsWith('Kỹ năng'))!
        expect(line).toContain('Kỹ năng số 20 (')
        expect(line).not.toContain('Kỹ năng số 14 (')
        expect(line).toContain('14 kỹ năng đã học nhưng chưa gắn')
    })
    it('recordScope: the whole list on the first reply, a record / ask / loadout turn and when the turn is unknown; slots only otherwise', () => {
        expect(recordScope(undefined)).toBe('all')
        for (const t of ['opening', 'record', 'ask', 'loadout'] as const) expect(recordScope(new Set([t])), t).toBe('all')
        expect(recordScope(new Set())).toBe('equipped')
        expect(recordScope(new Set(['fight', 'scout', 'help'] as const))).toBe('equipped')
    })
    it('withEquipped: the store view knows no slots; the open chat marks them, equipped first', () => {
        const store = buildView({ stats: {}, skills: { a: 900, b: 500, c: 100 } } as never, undefined)
        expect(store.skills.some((k) => k.equipped)).toBe(false)
        const v = withEquipped(store, { $skills: JSON.stringify({ c: { m: 100, eq: 1 }, a: { m: 900 } }) })
        expect(v.skills.map((k) => [k.id, k.equipped])).toEqual([['c', true], ['a', false], ['b', false]])
        expect(v.slots.used).toBe(1)
        expect(withEquipped(store, undefined)).toBe(store)
        expect(store.skills.some((k) => k.equipped)).toBe(false)   // the cached view is not touched
    })
})
