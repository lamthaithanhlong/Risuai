// Scorers for the Hệ thống voice that replaces Evelyn in the zombie card (owner 2026-11-05; L1 approved the scorer change, conditions on the branch
// log): the System speaks in 【…】 bracket lines and is never a person. Pure and deterministic, no model. Each goes red on its fixture
// (system.check.mjs builds the broken twins on purpose). companion.match is skipped ONLY for a persona fixture that DECLARES `companion: none`.
//   runs = [{ turns: [turn] }], turn = { shown, reply, raw? }   (the replies of one fresh run, creation turns included for noEvelyn)
import { companionProblems } from './narration.mjs'

export const VOICE_WITHIN = 6                       // the System voice has to speak in the first 6 story turns of a run
const L = '\\p{L}'
const EVELYN = new RegExp(`(?<!${L})evelyn(?!${L})`, 'iu')
const VOICE_LINE = /^[\s*_>]*【/
const SYS = `(?<!${L})hệ thống(?!${L})`
// narration that makes the System a person: it says, whispers, asks, smiles, looks, stands …
const PERSON_VERB = '(?:khẽ |nhẹ |lại |bất chợt )?(?:nói|thì thầm|thì thào|cười|hỏi|đáp|trả lời|mỉm cười|thở dài|lên tiếng|gọi|nhìn|quay sang|đứng|ngồi|bước|nhún vai|gật đầu|lắc đầu)'
const PERSON_RE = [new RegExp(`${SYS}\\s+${PERSON_VERB}(?!${L})`, 'iu'), new RegExp(`[”"]\\s*,?\\s*${SYS}\\s+${PERSON_VERB}(?!${L})`, 'iu')]
const HUMAN_REGISTER = new RegExp(`(?<!${L})(tớ|cậu)(?!${L})`, 'iu')    // Evelyn's register: the System never talks like a friend

const clip = (s, n = 90) => String(s).replace(/\s+/g, ' ').trim().slice(0, n)
export const voiceLines = (text) => String(text ?? '').split(/\r?\n/).filter((l) => VOICE_LINE.test(l))
const texts = (t) => [t.shown, t.reply].filter((x) => typeof x === 'string' && x)

/** the System's lines as plain sentences (brackets and the "HỆ THỐNG:" / "QUÉT:" label off): what guide.scout / guide.noSpoiler read for the System */
export function systemSpeech(reply) {
    return voiceLines(reply).map((l) => l.replace(/^[\s*_>]*【\s*/, '').replace(/】\s*[*_]*\s*$/, '').replace(/^(?:HỆ THỐNG|QUÉT|GHI NHẬN|NHẬN DẠNG MẪU|NHIỆM VỤ)\s*[:—–-]\s*/i, '').trim()).filter(Boolean)
}
/** the same sentences as quoted speech, the shape guide.scout expects, so the scorer itself stays as it is */
export const asSpeech = (reply) => systemSpeech(reply).map((s) => `“${s}”`).join('\n')

/** system.present: in every run the System voice speaks within the first VOICE_WITHIN turns, never as a person, never in Evelyn's words */
export function presentProblems(runs, within = VOICE_WITHIN) {
    const out = []
    runs.forEach((run, r) => {
        const turns = run.turns ?? []
        if (!turns.slice(0, within).some((t) => texts(t).some((x) => voiceLines(x).length))) out.push({ rule: 'no-voice', text: `run ${r + 1}: no 【…】 System line in the first ${within} turns` })
        turns.forEach((t, i) => {
            const text = t.shown || t.reply || ''
            const prose = text.split(/\r?\n/).filter((l) => !VOICE_LINE.test(l)).join('\n')
            for (const re of PERSON_RE) { const m = re.exec(prose); if (m) { out.push({ rule: 'person', text: `run ${r + 1} turn ${i + 1}: «${clip(prose.slice(Math.max(0, m.index - 10)).slice(0, 80))}»` }); break } }
            for (const l of voiceLines(text)) {
                if (HUMAN_REGISTER.test(l)) out.push({ rule: 'person', text: `run ${r + 1} turn ${i + 1}: the System talks as a friend: «${clip(l)}»` })
                if (EVELYN.test(l)) out.push({ rule: 'evelyn-voice', text: `run ${r + 1} turn ${i + 1}: «${clip(l)}»` })
            }
        })
    })
    return out
}

/** system.noEvelyn: the word Evelyn is in no reply of a no-Evelyn run (the replies, never the player's own text) */
export function noEvelynProblems(runs) {
    const out = []
    runs.forEach((run, r) => (run.turns ?? []).forEach((t, i) => { for (const x of texts(t)) { const m = EVELYN.exec(x); if (m) { out.push({ rule: 'evelyn', text: `run ${r + 1} turn ${i + 1}: «${clip(x.slice(Math.max(0, m.index - 20)), 70)}»` }); break } } }))
    return out
}

const NAMED_COMPANION_LINE = /đồng hành[^:\n]*:\**\s*(?!không\b)[^\s*]/i
/**
 * companion.match for a persona that DECLARES `companion: none` (the skip is explicit, never inferred from a missing name): the creation record
 * says "Đồng hành: Không" and no reply names a companion. `record` = the creation record, `replies` = the narrator's later replies.
 */
export function noCompanionProblems({ record, replies }) {
    const out = companionProblems(record, [])
    ;(replies ?? []).forEach((r, i) => {
        const m = NAMED_COMPANION_LINE.exec(String(r))
        if (m) out.push({ rule: 'companion-line', text: `reply ${i}: «${clip(String(r).slice(m.index), 70)}»` })
        if (EVELYN.test(String(r))) out.push({ rule: 'evelyn', text: `reply ${i}: Evelyn is back` })
    })
    return out
}

/** the persona fixture file: an optional first line `companion: none` (the declaration), then the persona text */
export function parsePersonaFixture(file) {
    const m = /^companion:\s*(\S+)[ \t]*\r?\n/i.exec(String(file ?? ''))
    return { companion: m ? m[1].toLowerCase() : null, text: m ? String(file).slice(m[0].length) : String(file ?? '') }
}

/** the check objects (score.mjs shape) */
export function systemChecks(runs, { all } = {}) {
    const n = runs.length
    const total = runs.reduce((s, r) => s + (r.turns?.length ?? 0), 0)
    const mk = (id, title, probs) => ({ id, title, status: n && !probs.length ? 'PASS' : 'FAIL', summary: probs.length ? `${probs.length} problem(s) over ${n} runs / ${total} turns` : `${n} runs, ${total} turns`, evidence: probs.map((p) => `${p.rule}: ${p.text}`) })
    return [
        mk('system.present', `The System voice (a 【…】 line) speaks within the first ${VOICE_WITHIN} turns of each of ${n} runs, is never a person (no said/looked/smiled, no tớ/cậu) and never says Evelyn`, presentProblems(runs)),
        mk('system.noEvelyn', 'The word Evelyn is in no reply of a run whose persona has no companion', noEvelynProblems(all ?? runs)),
    ]
}
