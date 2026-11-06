// What the Admin module exported for the Game Master ($admin_report: {turn, kind, text}) goes to POST /api/admin/report (server/node/adminReportBridge.cjs ->
// the asset manager's shared/_roles/admin_reports.jsonl). The Lua cannot write files, so the page does it after a reply. The chat's own text is never sent:
// only the card id, the chat id, the turn, the kind and the short report text. The store is idempotent by (chat, turn, kind), so a replayed or regenerated
// reply never adds a second line. Nothing here throws or holds a reply.
export const ADMIN_REPORT_KEY = '$admin_report'
export const REPORT_KINDS = ['bug', 'loop', 'deadline', 'dead_npc', 'mismatch'] as const
export type ReportBody = { card: string, chat: string, turn: number, kind: typeof REPORT_KINDS[number], text: string }

/** The report the module exported, with the card and chat ids, or null when there is none / it is malformed. */
export function reportOf(raw: unknown, ctx: { card: string, chat: string }): ReportBody | null {
    let j: any
    try { j = JSON.parse(String(raw ?? '')) } catch { return null }
    if (!j || typeof j !== 'object') return null
    const turn = Number(j.turn)
    const text = typeof j.text === 'string' ? j.text.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
    if (!Number.isInteger(turn) || turn < 0 || !text || !(REPORT_KINDS as readonly string[]).includes(j.kind)) return null
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(ctx.card) || !/^[A-Za-z0-9_.-]{1,64}$/.test(ctx.chat)) return null
    return { card: ctx.card, chat: ctx.chat, turn, kind: j.kind, text }
}

const defaultAuth = async () => (await import('./nodeStorage')).getNodeServerProxyAuth()

/** 'saved' (stored, merged or already there), 'drop' (the store refused it: it will never be accepted), 'queue' (down or slow: keep it for the next reply). */
export async function sendReport(body: ReportBody, deps: { fetch?: typeof fetch, auth?: () => Promise<string> } = {}): Promise<'saved' | 'drop' | 'queue'> {
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))('/api/admin/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'risu-auth': auth }, body: JSON.stringify(body),
        })
        if (r.status === 200) return 'saved'
        return r.status >= 400 && r.status < 500 ? 'drop' : 'queue'
    } catch { return 'queue' }
}

/** After a reply: sends $admin_report and clears it once the store has it (or refused it for good); a down store keeps it for the next reply. */
export async function reportAfterReply(chat: { id?: string, scriptstate?: Record<string, unknown> } | undefined, card: string,
    send: (b: ReportBody) => Promise<'saved' | 'drop' | 'queue'> = (b) => sendReport(b)): Promise<void> {
    try {
        const vars = chat?.scriptstate
        if (!chat || !vars || !card) return
        const raw = vars[ADMIN_REPORT_KEY]
        if (!raw) return
        const body = reportOf(raw, { card, chat: String(chat.id ?? '') })
        if (!body) { vars[ADMIN_REPORT_KEY] = ''; return }
        if ((await send(body)) !== 'queue') { if (vars[ADMIN_REPORT_KEY] === raw) vars[ADMIN_REPORT_KEY] = '' }
    } catch { /* the reply is never held by this */ }
}
