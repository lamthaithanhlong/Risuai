// The global side of the hidden training tag [[TRAIN|stat+stat|level]] for a card with no growth engine of its own (owner 2026-11-05: Admin is
// global, so every story's activities add a tiny exact amount to the persona's stats). The narrator names the level; the asset manager
// (tools/assets/train_store.py) owns the numbers, the cap, the regenerated-reply rule and the skip list (engine cards, Admin off or locked).
// Zombie's stats.lua does the same for its own panel, so a card whose description teaches [[ACT| never comes here (statsGlue.hasStatsRule).
//
//   parseTrain(text)                  -> {stats, level} | null     the first tag of a raw reply (the same tolerance as stats.lua parse_train)
//   trainBody(tag, ctx)               -> the POST body
//   sendTrain(body, deps)             -> 'saved' | 'skipped' | 'drop'     never throws; a tiny gain is not queued
export type TrainTag = { stats: string[], level: 'nhe' | 'vua' | 'manh' | 'cuc' }
export type TrainBody = { persona: string, card: string, chat: string, turn: number, stats: string[], level: TrainTag['level'] }

const STAT_IDS = ['suc_manh', 'nhanh_nhen', 'the_luc', 'tinh_than', 'cam_nhan', 'y_chi']
const STAT_NAMES: Record<string, string> = { 'sức mạnh': 'suc_manh', 'nhanh nhẹn': 'nhanh_nhen', 'thể lực': 'the_luc', 'tinh thần': 'tinh_than', 'cảm nhận': 'cam_nhan', 'ý chí': 'y_chi' }
const LEVELS: Record<string, TrainTag['level']> = {
    'nhẹ': 'nhe', nhe: 'nhe', 'vừa': 'vua', vua: 'vua', 'mạnh': 'manh', manh: 'manh',
    'cực': 'cuc', cuc: 'cuc', 'cực hạn': 'cuc', 'cuc han': 'cuc', cuc_han: 'cuc', 'cực_hạn': 'cuc',
}
const TAG = /\[\[\s*train(?![\p{L}\p{N}_])[\s|:]*([^\]\n]*)/iu

const statOf = (tok: string): string | null => {
    const t = tok.trim().toLowerCase()
    const id = t.replace(/-/g, '_')
    return STAT_IDS.includes(id) ? id : (STAT_NAMES[t] ?? null)
}

/** The first [[TRAIN|stat+stat|level]] of a raw reply: at most two valid stats, the level as written (accents or not); null when there is no
 *  tag, no valid stat or no valid level (the whole tag is dropped, as stats.lua does). */
export function parseTrain(text: string | null | undefined): TrainTag | null {
    const m = TAG.exec(text ?? '')
    if (!m) return null
    const f = m[1].split('|')
    const stats: string[] = []
    for (const tok of (f[0] ?? '').split(/[+,]/)) {
        const k = statOf(tok)
        if (k && !stats.includes(k) && stats.length < 2) stats.push(k)
    }
    const level = LEVELS[(f[1] ?? '').trim().toLowerCase().replace(/-/g, '_')]
    return stats.length && level ? { stats, level } : null
}

export function trainBody(tag: TrainTag, ctx: { persona: string, card: string, chat: string, turn: number }): TrainBody {
    return { persona: ctx.persona, card: ctx.card, chat: ctx.chat, turn: ctx.turn, stats: tag.stats, level: tag.level }
}

const defaultAuth = async () => (await import('./nodeStorage')).getNodeServerProxyAuth()

/** One POST to the server's bridge. 'skipped' when the store skipped the card (engine, Admin off or locked); anything that fails is 'drop'. */
export async function sendTrain(body: TrainBody, deps: { fetch?: typeof fetch, auth?: () => Promise<string> } = {}): Promise<'saved' | 'skipped' | 'drop'> {
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))('/api/train', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'risu-auth': auth },
            body: JSON.stringify(body),
        })
        if (r.status !== 200) return 'drop'
        const j = await r.json()
        return j?.applied === true ? 'saved' : 'skipped'
    } catch { return 'drop' }
}
