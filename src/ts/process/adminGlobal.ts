// Admin is global (owner 2026-11-05: "lore sẽ không có admin nhưng admin là global, mọi truyện trong Risu sẽ có admin"): no card
// carries Admin in its lore; the asset manager's shared/characters/admin.md (CARDS: global) is fetched through the Risu server
// (GET /api/admin?card=<id>, server/node/adminBridge.cjs, which keeps the last good copy on disk) and put into every request of
// every character as one system message at the end of the prompt's leading system block. The world's @sections are chosen by the
// card id (adminCardOf). Nothing here ever blocks a reply: no copy anywhere = the request goes without Admin, one log line.
// Design: nguoi-dua-thu-khung-bo/.pm-risu-5h/admin-global-design.md

export type AdminAsset = { id: string; title: string; keys?: string[]; body: string }
export type AdminPayload = { card: string; enabled?: boolean; assets: AdminAsset[]; guide: string; text: string; sha?: string; stale?: boolean; cachedAt?: string }

type CardLike = { chaId?: string; type?: string; extentions?: Record<string, unknown>; globalLore?: { comment?: string }[] } | undefined

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

/** A card built before Admin went global still has the lore entry "Admin": then its own copy is used and nothing is injected. */
export function cardHasOwnAdmin(card: CardLike): boolean {
    return (card?.globalLore ?? []).some((l) => /^\s*Admin(\s*\(\d+\))?\s*$/.test(l?.comment ?? ''))
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
export function fitBudget(assets: AdminAsset[], budget = ADMIN_BUDGET): { text: string; cut: string[] } {
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
    }).join('\n\n')
    const cut: string[] = []
    let text = render()
    for (let j = parts.length - 1; j >= 0 && text.length > budget; j--) {
        if (parts[j].keep) continue
        cut.push(parts[j].head.replace(/^##\s*/, ''))
        parts.splice(j, 1)
        text = render()
    }
    return { text, cut }
}

export const ADMIN_BOOT = '[Admin boot: this is the first reply of this chat: begin it with Admin\'s connect lines (see "Connecting and standing duties"), then never again unless the player asks.]'

/** The system message's text, or '' (switched off, empty). {{user}} becomes the persona's name; the boot line only on the first reply. */
export function adminBlock(p: AdminPayload | null, opts: { user?: string; opening?: boolean; budget?: number; log?: (m: string) => void } = {}): string {
    if (!p || p.enabled === false || !p.assets?.length) return ''
    const { text, cut } = fitBudget(p.assets, opts.budget ?? ADMIN_BUDGET)
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

export type AdminDeps = {
    fetch: (input: string, init?: RequestInit) => Promise<Response>
    auth: () => Promise<string> | string
    now?: () => number
    timeoutMs?: number
    log?: (m: string) => void
}

const valid = (d: unknown): d is AdminPayload =>
    !!d && typeof d === 'object' && Array.isArray((d as AdminPayload).assets) && typeof (d as AdminPayload).text === 'string'

/** The payload for this card: fresh within the TTL from memory, else asked (1.5 s at most), else the last good one, else null. */
export async function fetchAdmin(card: string, deps: AdminDeps): Promise<AdminPayload | null> {
    const now = deps.now?.() ?? Date.now()
    const hit = cache.get(card)
    if (hit && now - hit.at < ADMIN_TTL_MS) return hit.payload
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? ADMIN_TIMEOUT_MS)
    let why = ''
    try {
        const res = await deps.fetch(`/api/admin?card=${encodeURIComponent(card)}`, { headers: { 'risu-auth': await deps.auth() }, signal: ctl.signal })
        const data = res.ok ? await res.json() : null
        if (valid(data)) {
            cache.set(card, { at: now, payload: data })
            if (data.stale) deps.log?.(`[Admin] ${card}: the asset manager is down, using the server's copy of ${data.cachedAt ?? '?'}`)
            return data
        }
        why = `the server answered ${res.status}`
    } catch {
        why = ctl.signal.aborted ? 'no answer in time' : 'the server is not reachable'
    } finally {
        clearTimeout(timer)
    }
    if (hit) {
        deps.log?.(`[Admin] ${card}: ${why}, using the copy from ${new Date(hit.at).toISOString()}`)
        return hit.payload
    }
    deps.log?.(`[Admin] ${card}: ${why} and no copy, the request goes without Admin`)
    return null
}

/** The guide's name Admin's payload gave for this card (cached), for a card whose lore names no "Story guide: …"; '' otherwise. */
export function adminGuideFor(card: CardLike): string {
    if (!card || cardHasOwnAdmin(card)) return ''
    const p = cache.get(adminCardOf(card))?.payload
    return p && p.enabled !== false ? p.guide ?? '' : ''
}

/** The whole step for one request: a story character (not a group) whose card has no Admin of its own gets the global Admin. */
export async function adminBeforeRequest<T extends { role: string; content: unknown }>(formated: T[], card: CardLike,
    messages: { role: string }[] | undefined, user: string, deps: AdminDeps): Promise<T[]> {
    if (!card || card.type === 'group' || cardHasOwnAdmin(card)) return formated
    const id = adminCardOf(card)
    let p: AdminPayload | null = null
    try { p = await fetchAdmin(id, deps) } catch { p = null }
    const opening = !(messages ?? []).some((m) => m.role === 'char')
    return adminRequest(formated, adminBlock(p, { user, opening, log: deps.log }))
}
