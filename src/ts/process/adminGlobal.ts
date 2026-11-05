// Admin is global (owner 2026-11-05: "lore sẽ không có admin nhưng admin là global, mọi truyện trong Risu sẽ có admin") and FORCED
// (owner 2026-11-05: "mọi truyện admin đều phải apply force"): the asset manager's shared/characters/admin.md (CARDS: global) is
// fetched through the Risu server (GET /api/admin?card=<id>, server/node/adminBridge.cjs, which keeps the last good copy on disk) and
// put into every request of every chat as one system message at the end of the prompt's leading system block. The world's @sections
// are chosen by the card id (adminCardOf). There is no path that skips it:
//   - a group chat gets the Admin of the member that speaks (the call site passes it); a group with no speaker known: "cha-<group id>";
//   - a card that still carries its own "Admin" / "Story guide: Admin" lore entry still gets the global Admin; only an asset whose
//     exact text (same title, same text after trimming and collapsing whitespace) is already in the card's lore is left out, so the
//     same text is never sent twice (ownCopies / dedupe);
//   - no answer and no copy anywhere: the built-in core (adminFallback.ts, <= 1200 chars) is used.
// One debug line per request names the source used (fresh / stale cache / built-in / off), never the text; lastAdminSource() too.
// THE ONLY WAY TO SWITCH ADMIN OFF is the per-card list in the asset manager's shared/_roles/global.json {"off": [<card id>]}: the
// payload then says enabled:false and nothing is injected, not even the built-in core. An off answer is remembered (memory here,
// the server's disk copy, and the server reads global.json itself when the asset manager is down), so an off card stays off offline.
// FAIL-CLOSED: every card id ever answered enabled:false is kept in localStorage (OFF_SEEN_KEY, a JSON list). When the off state of
// such a card cannot be determined (no answer, no memory copy, no server copy, and the server could not read global.json), it gets
// NO Admin and NO built-in core: one line "[Admin] <card>: source=off (unknown, fail-closed)". A card never seen off still gets the
// built-in core. Only a fresh (not stale) answer with enabled true takes a card out of the list (the owner switched it back on).
// Storage blocked, missing or holding anything but a list of strings counts as an empty list, i.e. the card behaves as never seen.
// Nothing here ever blocks a reply for more than 1.5 s.
// Design: nguoi-dua-thu-khung-bo/.pm-risu-5h/admin-global-design.md

import { buildView, fetchFindNames, type View } from './personaStats'
import { fetchCurrent } from '../storage/statsSave'
import { FALLBACK_PAYLOAD } from './adminFallback'

export type AdminAsset = { id: string; title: string; keys?: string[]; body: string }
export type AdminPayload = { card: string; enabled?: boolean; assets: AdminAsset[]; guide: string; text: string; sha?: string; stale?: boolean; cachedAt?: string }

type CardLike = { chaId?: string; type?: string; extentions?: Record<string, unknown>; globalLore?: { comment?: string; content?: string }[] } | undefined

/** chaId prefix -> the asset manager's card id, for the cards that went live before their builds carried extensions.risu_story_card. */
export const STORY_CARD_IDS: Record<string, string> = {
    fc27f53b: 'zombie',
    aa7f021d: 'mailman',
    '22a987d8': 'lotm',
    '04103f68': 'shadow-slave',
}

const ID_RE = /^[a-z0-9-]{1,40}$/

/** The card id Admin's @sections are chosen by: the build's extension, else the known chaId table, else "cha-<first 8 of chaId>". */
export function adminCardOf(card: CardLike): string {
    const ext = card?.extentions?.risu_story_card
    if (typeof ext === 'string' && ID_RE.test(ext)) return ext
    const cha = String(card?.chaId ?? '').toLowerCase()
    for (const [prefix, id] of Object.entries(STORY_CARD_IDS)) if (cha.startsWith(prefix)) return id
    const short = cha.replace(/[^a-z0-9]/g, '').slice(0, 8)
    return short ? `cha-${short}` : ''
}

/** A card built before Admin went global still has the lore entry "Admin" (it still gets the global Admin, without the same text twice). */
export function cardHasOwnAdmin(card: CardLike): boolean {
    return (card?.globalLore ?? []).some((l) => /^\s*Admin(\s*\(\d+\))?\s*$/.test(l?.comment ?? ''))
}

const norm = (t: string) => (t ?? '').replace(/\s+/g, ' ').trim()

/**
 * The payload without the assets the card already carries word for word: an asset is left out only when a lore entry of the card has
 * the same title (comment) and the same text after trimming and collapsing whitespace. A different or older text is not a copy, so
 * the global one still goes in. Returns the payload unchanged when nothing matches.
 */
export function dedupeOwn(p: AdminPayload, card: CardLike): AdminPayload {
    const own = new Set((card?.globalLore ?? []).map((l) => `${norm(l?.comment ?? '')}\u0000${norm(l?.content ?? '')}`))
    if (!own.size) return p
    const assets = p.assets.filter((a) => !own.has(`${norm(a.title)}\u0000${norm(a.body)}`))
    return assets.length === p.assets.length ? p : { ...p, assets }
}

/** ~3000 tokens. */
export const ADMIN_BUDGET = 12000

const isRole = (a: AdminAsset) => a.id.startsWith('_roles/')
const protectedHeading = (h: string) => /^##\s*Connecting\b/i.test(h)

type Part = { asset: number; head: string; text: string; keep: boolean }

/**
 * The text inside the budget, and the headings cut. Deterministic: whole "## " sections are dropped from the end of the last
 * non-role asset backwards; never an intro, never a "Connecting…" section, never a role (Story guide) block.
 */
export function fitBudget(assets: AdminAsset[], budget = ADMIN_BUDGET, record = ''): { text: string; cut: string[] } {
    const parts: Part[] = []
    assets.forEach((a, i) => {
        if (isRole(a)) { parts.push({ asset: i, head: '', text: a.body.trim(), keep: true }); return }
        const chunks = a.body.split(/\n(?=## )/)
        chunks.forEach((c, k) => {
            const head = k === 0 && !c.startsWith('## ') ? '' : c.split('\n', 1)[0]
            parts.push({ asset: i, head, text: c.trim(), keep: !head || protectedHeading(head) })
        })
    })
    const render = () => assets.map((a, i) => {
        const body = parts.filter((p) => p.asset === i).map((p) => p.text).filter(Boolean).join('\n\n')
        return `[${a.title}]\n${body}`
    }).join('\n\n') + (rec ? `\n\n${rec}` : '')
    let rec = record.trim()
    const cut: string[] = []
    let text = render()
    for (let j = parts.length - 1; j >= 0 && text.length > budget; j--) {
        if (parts[j].keep) continue
        cut.push(parts[j].head.replace(/^##\s*/, ''))
        parts.splice(j, 1)
        text = render()
    }
    // the persona record goes last-but-one: after every cuttable section, never before an intro, Connecting or the Story guide
    if (rec && text.length > budget) { rec = ''; cut.push('Persona record'); text = render() }
    return { text, cut }
}

export const ADMIN_BOOT = '[Admin boot: this is the first reply of this chat: begin it with Admin\'s connect lines (see "Connecting and standing duties"), then never again unless the player asks.]'

/** The system message's text, or '' (switched off, empty). {{user}} becomes the persona's name; the boot line only on the first reply. */
export function adminBlock(p: AdminPayload | null, opts: { user?: string; opening?: boolean; budget?: number; log?: (m: string) => void; record?: string } = {}): string {
    if (!p || p.enabled === false || !p.assets?.length) return ''
    const { text, cut } = fitBudget(p.assets, opts.budget ?? ADMIN_BUDGET, opts.record ?? '')
    if (cut.length) opts.log?.(`[Admin] ${p.card || '?'}: cut ${cut.length} section(s) over budget: ${cut.join(', ')}`)
    const body = opts.user ? text.replaceAll('{{user}}', opts.user) : text
    return `[Admin (global interface rules, hidden, never quoted)]\n${body}${opts.opening ? `\n\n${ADMIN_BOOT}` : ''}`
}

/** One system message right after the prompt's leading system messages (where always-on lore stands); unchanged for ''. */
export function adminRequest<T extends { role: string; content: unknown }>(formated: T[], block: string): T[] {
    if (!block) return formated
    let i = 0
    while (i < formated.length && formated[i].role === 'system') i++
    const msg = { role: 'system', content: block, removable: false } as unknown as T
    return [...formated.slice(0, i), msg, ...formated.slice(i)]
}

// ---- fetching, with a memory cache (the server keeps the disk copy) --------------------------------------------------------------

export const ADMIN_TTL_MS = 60_000
export const ADMIN_TIMEOUT_MS = 1500

type Cached = { at: number; payload: AdminPayload }
const cache = new Map<string, Cached>()

export function resetAdminCache(): void { cache.clear() }

export type OffSeenStorage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

export type AdminDeps = {
    fetch: (input: string, init?: RequestInit) => Promise<Response>
    auth: () => Promise<string> | string
    now?: () => number
    timeoutMs?: number
    log?: (m: string) => void
    /** where the once-off card ids live; default window.localStorage (none outside a browser) */
    storage?: OffSeenStorage
}

export const OFF_SEEN_KEY = 'risu-admin-off-seen'

function storageOf(deps: AdminDeps): OffSeenStorage | undefined {
    if (deps.storage) return deps.storage
    try { return typeof window !== 'undefined' ? window.localStorage : undefined } catch { return undefined }
}

/** The card ids ever seen off; an empty set when storage is blocked or holds anything but a list of strings. Never throws. */
export function readOffSeen(deps: AdminDeps): Set<string> {
    try {
        const v = JSON.parse(storageOf(deps)?.getItem(OFF_SEEN_KEY) ?? '[]')
        return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : new Set()
    } catch { return new Set() }
}

function writeOffSeen(deps: AdminDeps, card: string, off: boolean): void {
    try {
        const set = readOffSeen(deps)
        if (set.has(card) === off) return
        if (off) set.add(card); else set.delete(card)
        storageOf(deps)?.setItem(OFF_SEEN_KEY, JSON.stringify([...set]))
    } catch { /* blocked storage: the card simply behaves as never seen */ }
}

const valid = (d: unknown): d is AdminPayload =>
    !!d && typeof d === 'object' && Array.isArray((d as AdminPayload).assets) && typeof (d as AdminPayload).text === 'string'

/** The payload for this card: fresh within the TTL from memory, else asked (1.5 s at most), else the last good one, else null. */
export async function fetchAdmin(card: string, deps: AdminDeps): Promise<AdminPayload | null> {
    return (await fetchAdminFull(card, deps)).payload
}

/** fetchAdmin, plus offKnown: true only when the server said so (it read global.json and the card is not on it). */
async function fetchAdminFull(card: string, deps: AdminDeps): Promise<{ payload: AdminPayload | null; offKnown: boolean }> {
    const now = deps.now?.() ?? Date.now()
    const hit = cache.get(card)
    if (hit && now - hit.at < ADMIN_TTL_MS) return { payload: hit.payload, offKnown: true }
    let offKnown = false
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? ADMIN_TIMEOUT_MS)
    let why = ''
    try {
        const res = await deps.fetch(`/api/admin?card=${encodeURIComponent(card)}`, { headers: { 'risu-auth': await deps.auth() }, signal: ctl.signal })
        let data: unknown = null
        try { data = await res.json() } catch { data = null }
        if (res.ok && valid(data)) {
            cache.set(card, { at: now, payload: data })
            if (data.stale) deps.log?.(`[Admin] ${card}: the asset manager is down, using the server's copy of ${data.cachedAt ?? '?'}`)
            return { payload: data, offKnown: true }
        }
        offKnown = !!data && typeof data === 'object' && (data as { offKnown?: unknown }).offKnown === true
        why = `the server answered ${res.status}`
    } catch {
        why = ctl.signal.aborted ? 'no answer in time' : 'the server is not reachable'
    } finally {
        clearTimeout(timer)
    }
    if (hit) {
        deps.log?.(`[Admin] ${card}: ${why}, using the copy from ${new Date(hit.at).toISOString()}`)
        return { payload: hit.payload, offKnown: true }
    }
    deps.log?.(`[Admin] ${card}: ${why} and no copy`)
    return { payload: null, offKnown }
}

export type AdminSource = 'fresh' | 'stale cache' | 'built-in' | 'off'
let lastSource: { card: string; source: AdminSource } | null = null
/** The source Admin's text came from for the last request (debug; no content). */
export function lastAdminSource(): { card: string; source: AdminSource } | null { return lastSource }

/**
 * The payload to use and where it came from; null for a card switched off in global.json, and for a card once seen off whose off
 * state cannot be determined now (fail-closed). Never throws.
 */
export async function resolveAdmin(card: string, deps: AdminDeps): Promise<{ payload: AdminPayload | null; source: AdminSource }> {
    const now = deps.now?.() ?? Date.now()
    const before = cache.get(card)
    let p: AdminPayload | null = null
    let offKnown = false
    try { ({ payload: p, offKnown } = await fetchAdminFull(card, deps)) } catch { p = null }
    let source: AdminSource
    let note = ''
    if (p && p.enabled === false) { source = 'off'; writeOffSeen(deps, card, true) }
    else if (p && p.assets?.length) {
        const fromOldCopy = before && before.payload === p && now - before.at >= ADMIN_TTL_MS
        source = p.stale || fromOldCopy ? 'stale cache' : 'fresh'
    } else if (!p && !offKnown && readOffSeen(deps).has(card)) { source = 'off'; note = ' (unknown, fail-closed)' }
    else { source = 'built-in' }
    // only a fresh answer of the asset manager that says on takes the card out of the once-off list
    if (p && p.enabled !== false && !p.stale && !(before && before.payload === p)) writeOffSeen(deps, card, false)
    if (source === 'built-in') p = FALLBACK_PAYLOAD(card)
    lastSource = { card, source }
    deps.log?.(`[Admin] ${card}: source=${source}${note}`)
    return { payload: source === 'off' ? null : p, source }
}

/** The guide's name Admin's payload gave for this card (cached), for a card whose lore names no "Story guide: …"; '' otherwise. */
export function adminGuideFor(card: CardLike): string {
    if (!card || cardHasOwnAdmin(card)) return ''
    const p = cache.get(adminCardOf(card))?.payload
    return p && p.enabled !== false ? p.guide ?? '' : ''
}

/**
 * The whole step for one request: every chat gets Admin (a group: pass the member that speaks; the group itself works too), a card
 * with its own Admin lore gets the global one without the text it already carries, no copy anywhere = the built-in core. Only a
 * card switched off in global.json gets nothing.
 */
export async function adminBeforeRequest<T extends { role: string; content: unknown }>(formated: T[], card: CardLike,
    messages: { role: string }[] | undefined, user: string, deps: AdminDeps,
    persona?: { id: string; chat?: { scriptstate?: Record<string, unknown> } }): Promise<T[]> {
    const id = adminCardOf(card) || 'cha-unknown'
    const { payload } = await resolveAdmin(id, deps)
    if (!payload) return formated
    const p = dedupeOwn(payload, card)
    if (!p.assets.length) return formated   // the card carries every part word for word already: Admin is in the prompt once
    // the persona record is mandatory in every story Admin goes into (owner 2026-11-05: "mọi truyện admin phải dùng stat của persona,
    // bắt buộc"); a story with its own engine gets it in words (its gated lines never carry stat numbers), one with none gets the values
    let record = ''
    if (card?.type === 'group') deps.log?.(`[Admin] ${id}: group chat with no speaking member known, the request goes without the persona record`)
    else if (persona) {
        try {
            const view = await fetchRecord(persona.id, deps)
            if (view) record = personaRecordText(view, user, hasOwnEngine(card, persona.chat) ? 'words' : 'numbers')
        } catch { record = '' }
    }
    const opening = !(messages ?? []).some((m) => m.role === 'char')
    return adminRequest(formated, adminBlock(p, { user, opening, log: deps.log, record }))
}

// ---- the persona record (stats, slots, skills, items) from the global store, in every story (words where the story has an engine) --
// Design: nguoi-dua-thu-khung-bo/.pm-risu-5h/admin-persona-record.md

export const RECORD_TITLE = '[Hồ sơ persona (kho chung, chỉ đọc)]'

/** A card with its own growth panel (a registered story card, the [[ACT| rule, or `$stats` in the chat): its record is in words. */
export function hasOwnEngine(card: CardLike, chat?: { scriptstate?: Record<string, unknown> }): boolean {
    const ext = card?.extentions?.risu_story_card
    if (typeof ext === 'string' && ID_RE.test(ext)) return true
    const cha = String(card?.chaId ?? '').toLowerCase()
    if (Object.keys(STORY_CARD_IDS).some((k) => cha.startsWith(k))) return true
    if (/\[\[ACT\|/.test((card as { desc?: string } | undefined)?.desc ?? '')) return true
    const st = chat?.scriptstate?.$stats
    return st !== undefined && st !== null && String(st).trim() !== '' && String(st) !== 'null'
}

export type RecordStyle = 'words' | 'numbers'

export const RECORD_WORDS_HEADER = 'Sự thật chung của persona qua mọi truyện; bảng chỉ số của truyện (nếu có) vẫn là chỗ hiện số. Không bao giờ viết con số, phần trăm hay số thập phân của chỉ số hay kỹ năng: chỉ nói bằng lời (cao, thấp, cấp kỹ năng).'

const VI_COUNT = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười']

/** One stat in words, from its place among the persona's stats: never a number. */
function statWord(v: number, all: number[]): string {
    const max = Math.max(...all), min = Math.min(...all)
    if (max === min) return 'ngang các chỉ số khác'
    if (v === max) return 'cao nhất, khá hơn các chỉ số khác'
    if (v === min) return 'thấp nhất'
    return 'ở giữa'
}

/**
 * The block Admin reads. style 'numbers' (a card with no engine): the persona page's numbers (2 decimals). style 'words' (a registered
 * story card or a card with its own engine, whose Admin lines must never carry stat numbers): stats as ranks in words, the open slots
 * and skills with their tier, no percent and no decimals, and the rule "never write numbers". One plain line when the store has nothing.
 */
export function personaRecordText(view: View, name: string, style: RecordStyle = 'numbers'): string {
    const who = name || 'persona'
    if (view.source === 'none') return `${RECORD_TITLE}\nPersona: ${who}\nKho chung chưa ghi nhận chỉ số, kỹ năng hay vật phẩm nào của ${who}.`
    if (style === 'words') {
        const vals = view.stats.map((s) => Number(s.value) || 0)
        const slots = view.slots.total
        return [RECORD_TITLE, RECORD_WORDS_HEADER, `Persona: ${who}`,
            `Chỉ số: ${view.stats.map((s, i) => `${s.vi}: ${statWord(vals[i], vals)}`).join('; ')}`,
            `Ô kỹ năng mở: ${VI_COUNT[slots] ?? 'nhiều'}`,
            `Kỹ năng: ${view.skills.length ? view.skills.map((k) => `${k.name} (${k.tier.vi})`).join('; ') : 'chưa ghi nhận'}`,
            'Vật phẩm: kho chung chưa ghi nhận vật phẩm nào theo persona.'].join('\n')
    }
    const lines = [RECORD_TITLE, `Persona: ${who}`,
        `Chỉ số: ${view.stats.map((s) => `${s.vi} ${s.pct}`).join(', ')}`,
        `Ô kỹ năng mở: ${view.slots.total}`,
        `Kỹ năng: ${view.skills.length ? view.skills.map((k) => `${k.name} (thành thạo ${k.pct}, ${k.tier.vi})`).join('; ') : 'chưa ghi nhận'}`,
        'Vật phẩm: kho chung chưa ghi nhận vật phẩm nào theo persona.']
    return lines.join('\n')
}

type RecCached = { at: number; view: View }
const recCache = new Map<string, RecCached>()
export function resetRecordCache(): void { recCache.clear() }

/** The persona's view: fresh within the TTL, else asked (1.5 s at most), else the last good one, else null (one log line). */
export async function fetchRecord(persona: string, deps: AdminDeps): Promise<View | null> {
    const now = deps.now?.() ?? Date.now()
    const hit = recCache.get(persona)
    if (hit && now - hit.at < ADMIN_TTL_MS) return hit.view
    const io = { fetch: deps.fetch as typeof fetch, auth: async () => await deps.auth() }
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), deps.timeoutMs ?? ADMIN_TIMEOUT_MS) })
    const got = await Promise.race([Promise.all([fetchCurrent(persona, io), fetchFindNames(io)]), late]).catch(() => null)
    clearTimeout(timer)
    if (got && got[0]) {
        const view = buildView(got[0], undefined, got[1])
        recCache.set(persona, { at: now, view })
        return view
    }
    if (hit) { deps.log?.(`[Admin] persona ${persona}: the store did not answer, using the record from ${new Date(hit.at).toISOString()}`); return hit.view }
    deps.log?.(`[Admin] persona ${persona}: the store did not answer and there is no copy, the request goes without the persona record`)
    return null
}
