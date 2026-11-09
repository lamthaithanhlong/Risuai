export const CONSEQ_MAX_AGE = 5
export const MIN_END_TURNS = 100

export type ConseqEmotion = 'vui' | 'sợ' | 'đau' | 'tức'
type Ending = 'warm' | 'bitter' | 'break'
type GmState = { gm_path?: string; gm_consequences_due?: string; gm_past?: string; gm_beat?: string; gm_beat_at?: string }

const aliases: Record<string, ConseqEmotion> = {
    vui: 'vui', happy: 'vui', joy: 'vui', sợ: 'sợ', fear: 'sợ', afraid: 'sợ',
    đau: 'đau', grief: 'đau', pain: 'đau', sorrow: 'đau', sad: 'đau',
    tức: 'tức', anger: 'tức', rage: 'tức', angry: 'tức',
}
const LANDED = /^(done|paid|landed|given|received|happened|resolved|xong|rồi|đã\s+(xảy ra|trả|nhận|đến|tới|xong|thực hiện|hoàn thành|diễn ra|giao|có|được trả))/i

export function emotionOf(line: string): ConseqEmotion | '' {
    return line.split('|').map((field) => aliases[field.trim().toLowerCase()]).find(Boolean) ?? ''
}

export function stampConsequence(line: string, beat: number): string {
    const fields = line.split('|').map((field) => field.trim())
    if (!emotionOf(line) && fields.length === 2) fields.splice(1, 0, '')
    if (!/\|\s*@\d+/.test(line)) fields.push(`@${beat}`)
    return fields.join(' | ')
}

function pending(state: GmState): string[] {
    return (state.gm_consequences_due ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => {
        const fields = line.split('|').map((field) => field.trim())
        return !!line && !LANDED.test(fields.at(-1) ?? '')
    })
}

export function dueConsequences(state: GmState): string[] { return pending(state) }
export function overdueConsequences(state: GmState): string[] {
    const now = Number((state.gm_beat ?? '').split('|')[0].match(/\d+/)?.[0] ?? state.gm_beat_at ?? 0)
    return pending(state).filter((line) => {
        const stamp = /\|\s*@(?<beat>\d+)/i.exec(line)?.groups?.beat
        return stamp === undefined ? now >= CONSEQ_MAX_AGE : now - Number(stamp) >= CONSEQ_MAX_AGE
    })
}
export function forceConsequenceDice(state: GmState, dice: { consequence: boolean }): boolean {
    return dice.consequence || overdueConsequences(state).length > 0
}
export function canCloseArc(charCount: number): boolean { return charCount >= MIN_END_TURNS }

export function pickEnding(state: GmState, how = ''): Ending {
    const evidence = `${how}\n${state.gm_past ?? ''}\n${state.gm_consequences_due ?? ''}`.toLowerCase()
    if (/reconcil|forgiv|make peace|reunite|reconcili|hòa giải|tha thứ|làm lành|ấm áp/.test(evidence)) return 'warm'
    if (/kill|death|destroy|betray|revenge|vengeance|murder|giết|chết|phản bội|trả thù/.test(evidence)) return 'break'
    if (/tức|anger|rage|angry|sợ|fear|đau|grief|pain|sad|buồn/.test(evidence)) return 'bitter'
    return 'warm'
}

export function emotionToneHint(emotion: ConseqEmotion): string {
    return { vui: 'relief and joy in the scene', 'sợ': 'dread in the scene', đau: 'hurt or grief in the scene', tức: 'anger and confrontation in the scene' }[emotion]
}

export function longArcGmBlurb(charCount: number, overdue: string[]): string {
    const details = overdue.map((line) => `${line}${emotionOf(line) ? ` (${emotionToneHint(emotionOf(line))})` : ''}`).join('; ')
    return `Aim for a long story of about 100 turns. ${overdue.length ? `MUST land overdue consequences now: ${details} (phải hạ cánh).` : ''} ${charCount < MIN_END_TURNS ? 'Do not resolve or close the arc yet.' : ''}`.trim()
}
